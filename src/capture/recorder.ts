import { bytesToHex, SUPPORTED_DECODER } from "../domain/decoder";
import { validateSessionDocument } from "../domain/session";
import {
  MAX_SESSION_FILE_BYTES,
  sessionDocumentFileByteLength,
  utf8ByteLength,
} from "../data/session-file";
import {
  MAX_SESSION_DURATION_US,
  type DecoderDescriptor,
  type SessionDocument,
  type SourceDescriptor,
  type SourceRecord,
} from "../domain/types";

export const MAX_CAPTURE_RECORDS = 100_000;
export const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;
export const MAX_CAPTURE_RECORD_BYTES = 65_550;

export interface CaptureLimits {
  maxRecords: number;
  maxCapturedBytes: number;
  maxDurationUs: number;
  maxSessionFileBytes: number;
}

export type LiveSourceDescriptor = SourceDescriptor & { kind: "udp" | "serial" };

export interface CaptureRecorderOptions {
  sessionId: string;
  title: string;
  startedAt: string | Date;
  displayTimeZone: string;
  source: LiveSourceDescriptor;
  decoder?: DecoderDescriptor;
  /** Optional lower operational limits. Hard schema/import limits cannot be raised. */
  limits?: Partial<CaptureLimits>;
}

export interface CapturedBytes {
  offsetUs: number;
  bytes: Uint8Array;
  wireBytes?: number;
  kernelDropCounter?: number;
  signal?: SourceRecord["signal"];
}

export class CaptureRecorderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureRecorderError";
  }
}

const HARD_LIMITS: CaptureLimits = Object.freeze({
  maxRecords: MAX_CAPTURE_RECORDS,
  maxCapturedBytes: MAX_CAPTURE_BYTES,
  maxDurationUs: MAX_SESSION_DURATION_US,
  maxSessionFileBytes: MAX_SESSION_FILE_BYTES,
});

function safePositiveLimit(
  value: number | undefined,
  hardMaximum: number,
  label: string,
): number {
  if (value == null) return hardMaximum;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CaptureRecorderError(`${label} must be a positive safe integer.`);
  }
  if (value > hardMaximum) {
    throw new CaptureRecorderError(`${label} cannot exceed the hard limit of ${hardMaximum}.`);
  }
  return value;
}

function resolveLimits(limits: Partial<CaptureLimits> | undefined): CaptureLimits {
  return Object.freeze({
    maxRecords: safePositiveLimit(limits?.maxRecords, HARD_LIMITS.maxRecords, "Record limit"),
    maxCapturedBytes: safePositiveLimit(
      limits?.maxCapturedBytes,
      HARD_LIMITS.maxCapturedBytes,
      "Captured-byte limit",
    ),
    maxDurationUs: safePositiveLimit(limits?.maxDurationUs, HARD_LIMITS.maxDurationUs, "Duration limit"),
    maxSessionFileBytes: safePositiveLimit(
      limits?.maxSessionFileBytes,
      HARD_LIMITS.maxSessionFileBytes,
      "Session-file limit",
    ),
  });
}

function assertOffset(offsetUs: number, maximumUs: number): void {
  if (!Number.isSafeInteger(offsetUs) || offsetUs < 0) {
    throw new CaptureRecorderError("Capture offsets must be non-negative integer microseconds.");
  }
  if (offsetUs >= maximumUs) {
    throw new CaptureRecorderError(
      `Capture offset ${offsetUs}µs reaches the ${maximumUs}µs duration limit; stop before recording it.`,
    );
  }
}

function cloneSignal(signal: SourceRecord["signal"]): SourceRecord["signal"] {
  return signal == null ? undefined : { ...signal };
}

function deepFreeze<T>(value: T): T {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Collects already-delimited UDP datagrams or serial assembly outputs into the
 * immutable session format consumed by the replay pipeline.
 */
export class CaptureRecorder {
  readonly limits: CaptureLimits;

  private readonly options: Omit<CaptureRecorderOptions, "limits" | "startedAt"> & { startedAt: string };
  private readonly capturedRecords: SourceRecord[] = [];
  private capturedByteCount = 0;
  private serializedRecordBytes = 0;
  private lastOffsetUs = -1;
  private finalized = false;
  private readonly sessionFileEnvelopeBytes: number;

  constructor(options: CaptureRecorderOptions) {
    if (options.source.kind !== "udp" && options.source.kind !== "serial") {
      throw new CaptureRecorderError("Live capture sources must use UDP or serial transport.");
    }

    let startedAt: string;
    try {
      startedAt = options.startedAt instanceof Date
        ? options.startedAt.toISOString()
        : options.startedAt;
    } catch {
      throw new CaptureRecorderError("Capture start time must be a valid date with a UTC offset.");
    }
    const decoder = { ...(options.decoder ?? SUPPORTED_DECODER) };
    const source = { ...options.source };
    try {
      validateSessionDocument({
        format: "narrowslink/session",
        formatVersion: 1,
        id: options.sessionId,
        title: options.title,
        startedAt,
        displayTimeZone: options.displayTimeZone,
        durationUs: 1,
        source,
        decoder,
        records: [{
          id: "capture-configuration-probe",
          index: 0,
          sourceId: source.id,
          offsetUs: 0,
          dataHex: "00",
          captureBytes: 1,
          wireBytes: 1,
          transport: { kind: source.kind },
        }],
        incidents: [],
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Capture metadata is invalid.";
      throw new CaptureRecorderError(`Capture configuration is invalid: ${reason}`);
    }
    this.options = {
      sessionId: options.sessionId,
      title: options.title,
      startedAt,
      displayTimeZone: options.displayTimeZone,
      source,
      decoder,
    };
    this.limits = resolveLimits(options.limits);
    this.sessionFileEnvelopeBytes = sessionDocumentFileByteLength(
      this.buildDocument(this.limits.maxDurationUs, []),
    );
    if (this.sessionFileEnvelopeBytes >= this.limits.maxSessionFileBytes) {
      throw new CaptureRecorderError(
        `Capture metadata leaves no room for records within the ${this.limits.maxSessionFileBytes}-byte session-file limit.`,
      );
    }
  }

  get recordCount(): number {
    return this.capturedRecords.length;
  }

  get capturedBytes(): number {
    return this.capturedByteCount;
  }

  /** Compact file size reserved with the configured maximum-duration digits. */
  get projectedSessionFileBytes(): number {
    return this.sessionFileEnvelopeBytes
      + this.serializedRecordBytes
      + Math.max(0, this.recordCount - 1);
  }

  append(input: CapturedBytes): SourceRecord {
    if (this.finalized) {
      throw new CaptureRecorderError("Capture has already stopped; start a new recorder before appending bytes.");
    }
    assertOffset(input.offsetUs, this.limits.maxDurationUs);
    if (input.offsetUs < this.lastOffsetUs) {
      throw new CaptureRecorderError(
        `Capture offsets must be monotonic; received ${input.offsetUs}µs after ${this.lastOffsetUs}µs.`,
      );
    }
    if (!(input.bytes instanceof Uint8Array)) {
      throw new CaptureRecorderError("Captured records must use Uint8Array bytes.");
    }
    if (input.bytes.byteLength === 0) {
      if (this.options.source.kind !== "udp") {
        throw new CaptureRecorderError("Captured serial records must contain at least one byte.");
      }
    }
    if (input.bytes.byteLength > MAX_CAPTURE_RECORD_BYTES) {
      throw new CaptureRecorderError(
        `A captured record cannot exceed ${MAX_CAPTURE_RECORD_BYTES} bytes; split the transport input first.`,
      );
    }
    if (this.recordCount >= this.limits.maxRecords) {
      throw new CaptureRecorderError(
        `Capture reached its ${this.limits.maxRecords}-record limit; stop and save this session.`,
      );
    }
    if (this.capturedByteCount + input.bytes.byteLength > this.limits.maxCapturedBytes) {
      throw new CaptureRecorderError(
        `Capture would exceed its ${this.limits.maxCapturedBytes}-byte limit; stop and save this session.`,
      );
    }

    const wireBytes = input.wireBytes ?? input.bytes.byteLength;
    if (!Number.isSafeInteger(wireBytes) || wireBytes < input.bytes.byteLength) {
      throw new CaptureRecorderError("Wire byte count must be an integer at least as large as captured bytes.");
    }
    if (
      input.kernelDropCounter != null
      && (!Number.isSafeInteger(input.kernelDropCounter) || input.kernelDropCounter < 0)
    ) {
      throw new CaptureRecorderError("Kernel drop counter must be a non-negative integer.");
    }
    if (input.signal != null) {
      const { provenance, rssiDbm, snrDb } = input.signal;
      if (provenance !== "gateway-sidecar" && provenance !== "decoded-packet") {
        throw new CaptureRecorderError("Signal provenance must identify a gateway sidecar or decoded packet.");
      }
      if (rssiDbm != null && (!Number.isFinite(rssiDbm) || rssiDbm < -200 || rssiDbm > 100)) {
        throw new CaptureRecorderError("RSSI must be a finite value between -200 and 100 dBm.");
      }
      if (snrDb != null && (!Number.isFinite(snrDb) || snrDb < -100 || snrDb > 100)) {
        throw new CaptureRecorderError("SNR must be a finite value between -100 and 100 dB.");
      }
    }

    const index = this.recordCount;
    const record: SourceRecord = Object.freeze({
      id: `capture-record-${String(index + 1).padStart(6, "0")}`,
      index,
      sourceId: this.options.source.id,
      offsetUs: input.offsetUs,
      dataHex: bytesToHex(input.bytes),
      captureBytes: input.bytes.byteLength,
      wireBytes,
      transport: Object.freeze({
        kind: this.options.source.kind,
        ...(input.kernelDropCounter == null ? {} : { kernelDropCounter: input.kernelDropCounter }),
      }),
      ...(input.signal == null ? {} : { signal: Object.freeze(cloneSignal(input.signal)) }),
    });
    const recordFileBytes = utf8ByteLength(JSON.stringify(record));
    const projectedFileBytes = this.projectedSessionFileBytes
      + recordFileBytes
      + (this.recordCount > 0 ? 1 : 0);
    if (projectedFileBytes > this.limits.maxSessionFileBytes) {
      throw new CaptureRecorderError(
        `Capture would exceed its ${this.limits.maxSessionFileBytes}-byte replay-file limit after JSON and hex encoding; stop and save this session.`,
      );
    }

    this.capturedRecords.push(record);
    this.capturedByteCount += input.bytes.byteLength;
    this.serializedRecordBytes += recordFileBytes;
    this.lastOffsetUs = input.offsetUs;
    return record;
  }

  finalize(stoppedAtUs?: number): SessionDocument {
    if (this.finalized) {
      throw new CaptureRecorderError("Capture has already been finalized.");
    }
    if (this.recordCount === 0) {
      throw new CaptureRecorderError("Cannot finalize an empty capture; record at least one UDP datagram or serial segment.");
    }

    const requestedStopUs = stoppedAtUs ?? this.lastOffsetUs + 1;
    if (!Number.isSafeInteger(requestedStopUs) || requestedStopUs < 0) {
      throw new CaptureRecorderError("Capture stop time must be a non-negative integer microsecond offset.");
    }
    if (requestedStopUs < this.lastOffsetUs) {
      throw new CaptureRecorderError(
        `Capture stop time ${requestedStopUs}µs precedes the last record at ${this.lastOffsetUs}µs.`,
      );
    }

    const durationUs = Math.max(1, requestedStopUs, this.lastOffsetUs + 1);
    if (durationUs > this.limits.maxDurationUs) {
      throw new CaptureRecorderError(
        `Capture duration ${durationUs}µs exceeds the ${this.limits.maxDurationUs}µs limit.`,
      );
    }

    const document = this.buildDocument(durationUs, [...this.capturedRecords]);

    const validated = deepFreeze(validateSessionDocument(document));
    const fileBytes = sessionDocumentFileByteLength(validated);
    if (fileBytes > this.limits.maxSessionFileBytes || fileBytes > MAX_SESSION_FILE_BYTES) {
      throw new CaptureRecorderError(
        `Final replay is ${fileBytes} bytes and exceeds the ${this.limits.maxSessionFileBytes}-byte import limit.`,
      );
    }
    this.finalized = true;
    return validated;
  }

  private buildDocument(durationUs: number, records: SourceRecord[]): SessionDocument {
    return {
      format: "narrowslink/session",
      formatVersion: 1,
      id: this.options.sessionId,
      title: this.options.title,
      startedAt: this.options.startedAt,
      displayTimeZone: this.options.displayTimeZone,
      durationUs,
      source: { ...this.options.source },
      decoder: { ...(this.options.decoder ?? SUPPORTED_DECODER) },
      records,
      incidents: [{
        id: "capture-interval",
        title: "Captured interval",
        startUs: 0,
        endUs: durationUs,
        severity: "info",
      }],
    };
  }
}
