import { decodeRecord, getNumericField, SUPPORTED_DECODER } from "./decoder";
import {
  incidentPresetSchema,
  MAX_SESSION_DURATION_US,
  sessionDocumentSchema,
  type DecodedFrame,
  type DiagnosticEvent,
  type IncidentPreset,
  type IncidentProjection,
  type MetricBucket,
  type OffsetUs,
  type ParsedSession,
  type SessionDocument,
} from "./types";

const SECOND_US = 1_000_000;
const DECODER_RELOCK_STABILITY_US = 40 * SECOND_US;
const DECODER_RELOCK_MIN_VALID_FRAMES = 3;

export class SessionValidationError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "SessionValidationError";
    this.details = details;
  }
}

function assertIncidentWithinDuration(incident: IncidentPreset, durationUs: OffsetUs): void {
  if (incident.endUs > durationUs) {
    throw new SessionValidationError("An incident falls outside the declared session duration.", [
      `${incident.id} ends at ${incident.endUs}µs; duration is ${durationUs}µs`,
    ]);
  }
}

export function validateIncidentPreset(input: unknown, durationUs: OffsetUs): IncidentPreset {
  if (
    !Number.isSafeInteger(durationUs)
    || durationUs <= 0
    || durationUs > MAX_SESSION_DURATION_US
  ) {
    throw new SessionValidationError("The incident range cannot be validated against an invalid session duration.", [
      `Received duration ${durationUs}µs`,
    ]);
  }

  const result = incidentPresetSchema.safeParse(input);
  if (!result.success) {
    throw new SessionValidationError(
      "The incident range is invalid.",
      result.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "incident"}: ${issue.message}`),
    );
  }

  assertIncidentWithinDuration(result.data, durationUs);
  return result.data;
}

export function validateSessionDocument(input: unknown): SessionDocument {
  const result = sessionDocumentSchema.safeParse(input);
  if (!result.success) {
    throw new SessionValidationError(
      "The replay file does not match NarrowsLink session format version 1.",
      result.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`),
    );
  }

  const document = result.data;
  if (
    document.decoder.id !== SUPPORTED_DECODER.id
    || document.decoder.revision !== SUPPORTED_DECODER.revision
    || document.decoder.schemaHash.toLowerCase() !== SUPPORTED_DECODER.schemaHash
  ) {
    throw new SessionValidationError("The replay references an unsupported decoder schema.", [
      `Received ${document.decoder.id} ${document.decoder.revision} (${document.decoder.schemaHash})`,
      `Supported ${SUPPORTED_DECODER.id} ${SUPPORTED_DECODER.revision} (${SUPPORTED_DECODER.schemaHash})`,
    ]);
  }
  const seenIds = new Set<string>();
  let previousOffset = -1;

  for (const [position, record] of document.records.entries()) {
    if (seenIds.has(record.id)) {
      throw new SessionValidationError("The replay contains duplicate record IDs.", [`Duplicate record ID: ${record.id}`]);
    }
    seenIds.add(record.id);

    if (record.index !== position) {
      throw new SessionValidationError("Replay record indices must be contiguous and zero-based.", [
        `${record.id} declares index ${record.index}; expected ${position}`,
      ]);
    }

    if (record.sourceId !== document.source.id) {
      throw new SessionValidationError("A replay record references an unknown source.", [
        `${record.id} references ${record.sourceId}; expected ${document.source.id}`,
      ]);
    }
    if (record.offsetUs < previousOffset) {
      throw new SessionValidationError("Replay timestamps are not monotonic.", [
        `${record.id} at ${record.offsetUs}µs follows ${previousOffset}µs`,
      ]);
    }
    if (record.offsetUs >= document.durationUs) {
      throw new SessionValidationError("A replay record falls outside the declared session duration.", [
        `${record.id} at ${record.offsetUs}µs exceeds duration ${document.durationUs}µs`,
      ]);
    }
    if (record.captureBytes !== record.dataHex.length / 2) {
      throw new SessionValidationError("A replay record has inconsistent byte counts.", [
        `${record.id} declares ${record.captureBytes} bytes but contains ${record.dataHex.length / 2}`,
      ]);
    }
    if (record.wireBytes < record.captureBytes) {
      throw new SessionValidationError("A replay record declares fewer wire bytes than captured bytes.", [
        `${record.id} declares ${record.wireBytes} wire bytes and ${record.captureBytes} captured bytes`,
      ]);
    }
    if (record.transport.kind !== document.source.kind) {
      throw new SessionValidationError("A replay record transport does not match the declared source.", [
        `${record.id} uses ${record.transport.kind}; source uses ${document.source.kind}`,
      ]);
    }
    previousOffset = record.offsetUs;
  }

  const incidentIds = new Set<string>();
  for (const incident of document.incidents) {
    if (incidentIds.has(incident.id)) {
      throw new SessionValidationError("The replay contains duplicate incident IDs.", [`Duplicate incident ID: ${incident.id}`]);
    }
    incidentIds.add(incident.id);
    assertIncidentWithinDuration(incident, document.durationUs);
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: document.displayTimeZone }).format();
  } catch {
    throw new SessionValidationError("The replay declares an invalid IANA time zone.", [document.displayTimeZone]);
  }

  return document;
}

function numericField(frame: DecodedFrame, fieldName: string): number | null {
  return frame.status === "complete" ? getNumericField(frame, fieldName) : null;
}

function isTrustedMetricFrame(frame: DecodedFrame): boolean {
  return frame.status === "complete" && frame.integrity.status === "valid";
}

function createMetricBuckets(document: SessionDocument, frames: readonly DecodedFrame[]): MetricBucket[] {
  const bucketCount = Math.ceil(document.durationUs / SECOND_US);
  const bucketRows = Array.from({ length: bucketCount }, (_, index) => ({
    offsetUs: index * SECOND_US,
    received: 0,
    transportMissing: 0,
    sequenceMissing: 0,
    rssiTotal: 0,
    rssiCount: 0,
    jitterMs: null as number | null,
    latitude: null as number | null,
    longitude: null as number | null,
    altitudeM: null as number | null,
    radioTempC: null as number | null,
    busVoltageV: null as number | null,
    familyCounts: {} as Record<string, number>,
  }));

  let previousSequence: number | null = null;
  let previousTransitMs: number | null = null;
  let untrustedFramesSinceSequence = 0;
  let jitterMs = 0;
  let previousDropCounter: number | null = null;
  for (const frame of frames) {
    const bucketIndex = Math.min(bucketRows.length - 1, Math.floor(frame.offsetUs / SECOND_US));
    const bucket = bucketRows[bucketIndex];
    if (!bucket) continue;
    bucket.received += 1;

    const dropCounter = frame.sourceRecord.transport.kernelDropCounter;
    if (dropCounter != null) {
      if (previousDropCounter != null && dropCounter >= previousDropCounter) {
        bucket.transportMissing += dropCounter - previousDropCounter;
      }
      previousDropCounter = dropCounter;
    }

    const rssi = frame.sourceRecord.signal?.rssiDbm;
    if (typeof rssi === "number") {
      bucket.rssiTotal += rssi;
      bucket.rssiCount += 1;
    }

    if (isTrustedMetricFrame(frame) && frame.sequence != null && frame.deviceTimeMs != null) {
      if (previousSequence != null) {
        const delta = (frame.sequence - previousSequence + 65_536) % 65_536;
        if (delta > 1 && delta <= 32_768) {
          bucket.sequenceMissing += Math.max(0, delta - 1 - untrustedFramesSinceSequence);
        }
      }
      previousSequence = frame.sequence;
      untrustedFramesSinceSequence = 0;

      const transitMs = frame.offsetUs / 1000 - frame.deviceTimeMs;
      if (previousTransitMs != null) {
        const delta = Math.abs(transitMs - previousTransitMs);
        jitterMs += (delta - jitterMs) / 16;
      }
      previousTransitMs = transitMs;
      bucket.jitterMs = jitterMs;
    } else {
      untrustedFramesSinceSequence += 1;
    }

    const latitude = numericField(frame, "latitude");
    const longitude = numericField(frame, "longitude");
    const altitude = numericField(frame, "altitude");
    const radioTemp = numericField(frame, "radioTemp");
    const busVoltage = numericField(frame, "busVoltage");
    if (latitude != null) bucket.latitude = latitude;
    if (longitude != null) bucket.longitude = longitude;
    if (altitude != null) bucket.altitudeM = altitude;
    if (radioTemp != null) bucket.radioTempC = radioTemp;
    if (busVoltage != null) bucket.busVoltageV = busVoltage;

    const familyName = frame.familyName;
    bucket.familyCounts[familyName] = (bucket.familyCounts[familyName] ?? 0) + 1;
  }

  let carriedLatitude: number | null = null;
  let carriedLongitude: number | null = null;
  let carriedAltitude: number | null = null;
  let carriedRadioTemp: number | null = null;
  let carriedBusVoltage: number | null = null;
  for (const bucket of bucketRows) {
    if (bucket.latitude != null) carriedLatitude = bucket.latitude;
    if (bucket.longitude != null) carriedLongitude = bucket.longitude;
    if (bucket.altitudeM != null) carriedAltitude = bucket.altitudeM;
    if (bucket.radioTempC != null) carriedRadioTemp = bucket.radioTempC;
    if (bucket.busVoltageV != null) carriedBusVoltage = bucket.busVoltageV;
    bucket.latitude = carriedLatitude;
    bucket.longitude = carriedLongitude;
    bucket.altitudeM = carriedAltitude;
    bucket.radioTempC = carriedRadioTemp;
    bucket.busVoltageV = carriedBusVoltage;
  }

  return bucketRows.map((bucket) => {
    // Kernel-drop and sequence-gap signals may describe the same missing frames.
    // Use the larger per-second estimate so both sources contribute without double counting.
    const missing = Math.max(bucket.transportMissing, bucket.sequenceMissing);
    const expected = bucket.received + missing;
    return {
      offsetUs: bucket.offsetUs,
      received: bucket.received,
      missing,
      throughput: bucket.received,
      lossPct: expected > 0 ? (missing / expected) * 100 : 0,
      rssiDbm: bucket.rssiCount > 0 ? bucket.rssiTotal / bucket.rssiCount : null,
      jitterMs: bucket.jitterMs,
      latitude: bucket.latitude,
      longitude: bucket.longitude,
      altitudeM: bucket.altitudeM,
      radioTempC: bucket.radioTempC,
      busVoltageV: bucket.busVoltageV,
      familyCounts: bucket.familyCounts,
    };
  });
}

function makeDiagnostic(
  type: DiagnosticEvent["type"],
  severity: DiagnosticEvent["severity"],
  startUs: number,
  title: string,
  description: string,
  frameIds: string[] = [],
): DiagnosticEvent {
  return {
    id: `${type}-${startUs}${frameIds.length > 0 ? `-${frameIds.join("-")}` : ""}`,
    type,
    severity,
    startUs,
    title,
    description,
    frameIds,
  };
}

function deriveDiagnostics(frames: readonly DecodedFrame[], buckets: readonly MetricBucket[]): DiagnosticEvent[] {
  const events: DiagnosticEvent[] = [];
  let lowRssiBuckets = 0;
  let recoveryBuckets = 0;
  let lossBuckets = 0;
  let linkDegraded = false;
  let lossBurst = false;

  for (const bucket of buckets) {
    if (bucket.rssiDbm != null && bucket.rssiDbm < -90) {
      lowRssiBuckets += 1;
      recoveryBuckets = 0;
    } else if (bucket.rssiDbm != null && bucket.rssiDbm > -78) {
      recoveryBuckets += 1;
      lowRssiBuckets = 0;
    } else {
      lowRssiBuckets = 0;
      recoveryBuckets = 0;
    }

    if (!linkDegraded && lowRssiBuckets === 2) {
      linkDegraded = true;
      events.push(makeDiagnostic("link-degraded", "warning", bucket.offsetUs - SECOND_US, "Link quality degraded", `RSSI remained below −90 dBm; observed ${bucket.rssiDbm?.toFixed(0)} dBm.`));
    }
    if (linkDegraded && recoveryBuckets === 5) {
      linkDegraded = false;
      events.push(makeDiagnostic("recovery", "info", bucket.offsetUs - 4 * SECOND_US, "Link recovered", `RSSI stabilized above −78 dBm with ${bucket.lossPct.toFixed(1)}% loss.`));
    }

    if (bucket.lossPct >= 5) lossBuckets += 1;
    else lossBuckets = 0;
    if (!lossBurst && lossBuckets === 3) {
      lossBurst = true;
      events.push(makeDiagnostic("loss-burst", "critical", bucket.offsetUs - 2 * SECOND_US, "Sequence loss burst", `Missing sequences reached ${bucket.lossPct.toFixed(1)}% in the one-second window.`));
    }
    if (lossBurst && bucket.lossPct < 1) lossBurst = false;
  }

  let consecutiveInvalid = 0;
  let consecutiveValidAfterResync = 0;
  let validRecoveryStartedUs: number | null = null;
  let resyncing = false;
  for (const frame of frames) {
    if (frame.status !== "complete") {
      consecutiveInvalid += 1;
      consecutiveValidAfterResync = 0;
      validRecoveryStartedUs = null;
      const isCrc = frame.integrity.status === "crc-failed";
      events.push(makeDiagnostic(
        isCrc ? "crc-failure" : "partial-frame",
        isCrc ? "critical" : "warning",
        frame.offsetUs,
        isCrc ? "Checksum failure" : "Partial frame retained",
        isCrc ? "The frame checksum did not match the calculated CRC." : "The frame could not be decoded completely and remains available for inspection.",
        [frame.id],
      ));
      if (!resyncing && consecutiveInvalid === 2) {
        resyncing = true;
        events.push(makeDiagnostic("decoder-resync", "warning", frame.offsetUs, "Decoder resync", "Two consecutive invalid boundaries forced NSL-01 into resynchronization.", [frame.id]));
      }
    } else {
      consecutiveInvalid = 0;
      if (resyncing) {
        if (validRecoveryStartedUs == null) validRecoveryStartedUs = frame.offsetUs;
        consecutiveValidAfterResync += 1;
        const stableForUs = frame.offsetUs - validRecoveryStartedUs;
        if (
          consecutiveValidAfterResync >= DECODER_RELOCK_MIN_VALID_FRAMES
          && stableForUs >= DECODER_RELOCK_STABILITY_US
        ) {
          resyncing = false;
          validRecoveryStartedUs = null;
          events.push(makeDiagnostic(
            "decoder-locked",
            "info",
            frame.offsetUs,
            "Decoder locked",
            "At least three valid CRC frames over 40 uninterrupted seconds restored decoder boundary lock.",
            [frame.id],
          ));
        }
      }
    }
  }

  return events.sort((left, right) => left.startUs - right.startUs);
}

function missingFramesInRange(frames: readonly DecodedFrame[], startUs: number, endUs: number): number {
  const startIndex = lowerBoundByOffset(frames, startUs);
  const endIndex = lowerBoundByOffset(frames, endUs);
  const rangeFrames = frames.slice(startIndex, endIndex);
  let previousCounter = startIndex > 0
    ? (frames[startIndex - 1]?.sourceRecord.transport.kernelDropCounter ?? null)
    : null;
  let transportMissing = 0;
  for (const frame of rangeFrames) {
    const counter = frame.sourceRecord.transport.kernelDropCounter;
    if (counter != null && previousCounter != null && counter >= previousCounter) transportMissing += counter - previousCounter;
    if (counter != null) previousCounter = counter;
  }

  let previousSequence: number | null = null;
  let untrustedFramesSinceSequence = 0;
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const preceding = frames[index];
    if (preceding && isTrustedMetricFrame(preceding) && preceding.sequence != null) {
      previousSequence = preceding.sequence;
      for (let between = index + 1; between < startIndex; between += 1) {
        const frame = frames[between];
        if (frame && !isTrustedMetricFrame(frame)) untrustedFramesSinceSequence += 1;
      }
      break;
    }
  }
  let sequenceMissing = 0;
  for (const frame of rangeFrames) {
    if (isTrustedMetricFrame(frame) && frame.sequence != null) {
      if (previousSequence != null) {
        const delta = (frame.sequence - previousSequence + 65_536) % 65_536;
        if (delta > 1 && delta <= 32_768) sequenceMissing += Math.max(0, delta - 1 - untrustedFramesSinceSequence);
      }
      previousSequence = frame.sequence;
      untrustedFramesSinceSequence = 0;
    } else {
      untrustedFramesSinceSequence += 1;
    }
  }
  // Both counters can describe the same loss episode; retain the stronger estimate without summing overlap.
  return Math.max(transportMissing, sequenceMissing);
}

function peakJitterInRange(frames: readonly DecodedFrame[]): number | null {
  let previousTransitMs: number | null = null;
  let jitterMs = 0;
  let peak: number | null = null;
  for (const frame of frames) {
    if (!isTrustedMetricFrame(frame) || frame.deviceTimeMs == null) continue;
    const transitMs = frame.offsetUs / 1000 - frame.deviceTimeMs;
    if (previousTransitMs != null) {
      const delta = Math.abs(transitMs - previousTransitMs);
      jitterMs += (delta - jitterMs) / 16;
      peak = peak == null ? jitterMs : Math.max(peak, jitterMs);
    }
    previousTransitMs = transitMs;
  }
  return peak;
}

function linkAvailabilityInRange(frames: readonly DecodedFrame[], startUs: number, endUs: number): number | null {
  const bucketCount = Math.ceil((endUs - startUs) / SECOND_US);
  if (bucketCount <= 0) return null;
  const samples = new Map<number, { total: number; count: number }>();
  for (const frame of frames) {
    const rssi = frame.sourceRecord.signal?.rssiDbm;
    if (rssi == null) continue;
    const bucketIndex = Math.floor((frame.offsetUs - startUs) / SECOND_US);
    const sample = samples.get(bucketIndex) ?? { total: 0, count: 0 };
    sample.total += rssi;
    sample.count += 1;
    samples.set(bucketIndex, sample);
  }
  if (samples.size === 0) return null;
  const healthyBuckets = [...samples.values()].filter((sample) => sample.total / sample.count >= -90).length;
  return (healthyBuckets / bucketCount) * 100;
}

function diagnosticIntersectsRange(event: DiagnosticEvent, startUs: number, endUs: number): boolean {
  return event.endUs == null
    ? event.startUs >= startUs && event.startUs < endUs
    : event.startUs < endUs && event.endUs > startUs;
}

export function projectIncident(
  preset: Readonly<IncidentPreset>,
  frames: readonly DecodedFrame[],
  diagnostics: readonly DiagnosticEvent[],
): IncidentProjection {
  const incidentFrames = rowsInRange(frames, preset.startUs, preset.endUs);
  const incidentDiagnostics = diagnostics.filter((event) => diagnosticIntersectsRange(event, preset.startUs, preset.endUs));
  const completePackets = incidentFrames.filter((frame) => frame.status === "complete").length;
  const missingFrames = missingFramesInRange(frames, preset.startUs, preset.endUs);
  const expectedFrames = incidentFrames.length + missingFrames;
  let lowestRssiDbm: number | null = null;
  for (const frame of incidentFrames) {
    const sample = frame.sourceRecord.signal?.rssiDbm;
    if (sample != null && (lowestRssiDbm == null || sample < lowestRssiDbm)) lowestRssiDbm = sample;
  }
  const durationSeconds = (preset.endUs - preset.startUs) / SECOND_US;

  return {
    ...preset,
    diagnostics: incidentDiagnostics,
    stats: {
      receivedFrames: incidentFrames.length,
      expectedFrames,
      missingFrames,
      completePackets,
      lossPct: expectedFrames > 0 ? (missingFrames / expectedFrames) * 100 : null,
      decodeConfidencePct: incidentFrames.length > 0 ? (completePackets / incidentFrames.length) * 100 : null,
      lowestRssiDbm,
      peakJitterMs: peakJitterInRange(incidentFrames),
      averageThroughput: durationSeconds > 0 ? incidentFrames.length / durationSeconds : null,
      linkAvailabilityPct: linkAvailabilityInRange(incidentFrames, preset.startUs, preset.endUs),
    },
  };
}

export function parseSession(input: unknown): ParsedSession {
  const document = validateSessionDocument(input);
  const frames = document.records.map((record, ordinal) => decodeRecord(record, ordinal));
  const buckets = createMetricBuckets(document, frames);
  const diagnostics = deriveDiagnostics(frames, buckets);
  const incidentPresets: IncidentPreset[] = document.incidents.length > 0
    ? document.incidents
    : [{ id: "full-session", title: "Full session review", startUs: 0, endUs: document.durationUs, severity: "info" }];
  const incidents = incidentPresets.map((preset) => projectIncident(preset, frames, diagnostics));
  return {
    document,
    frames,
    buckets,
    diagnostics,
    incidents,
    framesById: new Map(frames.map((frame) => [frame.id, frame])),
  };
}

export function lowerBoundByOffset<T extends { offsetUs: number }>(rows: readonly T[], offsetUs: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const row = rows[middle];
    if (row && row.offsetUs < offsetUs) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function rowsInRange<T extends { offsetUs: number }>(rows: readonly T[], startUs: number, endUs: number): T[] {
  return rows.slice(lowerBoundByOffset(rows, startUs), lowerBoundByOffset(rows, endUs));
}
