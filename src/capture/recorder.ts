import {
  bytesToHex,
  NSL01_DECODER_PACK,
  resolveDecoderPack,
  validateDecoderPackRuntime,
} from "../domain/decoder";
import {
  decoderDescriptorForPack,
  validateDecoderPack,
} from "../domain/decoder-pack";
import { validateSessionDocument } from "../domain/session";
import {
  MAX_SESSION_FILE_BYTES,
  sessionDocumentFileByteLength,
  utf8ByteLength,
} from "../data/session-file";
import {
  captureIntegrityIssueCodes,
  MAX_TRANSPORT_EVENTS,
  MAX_SESSION_DURATION_US,
  transportProvenanceIssueCodes,
  transportEventSchema,
  udpBridgeJournalSchema,
  udpRemoteEndpointSchema,
  type CaptureIntegrityIssueCode,
  type CaptureIntegrityReceipt,
  type DecoderDescriptor,
  type DecoderPackDocument,
  type SerialTransportProvenance,
  type SessionDocument,
  type SessionDocumentV2,
  type SourceDescriptor,
  type SourceRecord,
  type TransportEvent,
  type TransportProvenance,
  type TransportProvenanceIssueCode,
  type UdpByteAccounting,
  type UdpBridgeJournal,
  type UdpRemoteEndpoint,
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
  decoderPack?: DecoderPackDocument;
  /** Optional lower operational limits. Hard schema/import limits cannot be raised. */
  limits?: Partial<CaptureLimits>;
}

export interface CapturedBytes {
  offsetUs: number;
  bytes: Uint8Array;
  wireBytes?: number;
  kernelDropCounter?: number | null;
  remoteEndpoint?: UdpRemoteEndpoint;
  signal?: SourceRecord["signal"];
}

type WithoutEventIdentity<T> = T extends unknown ? Omit<T, "id" | "index"> : never;

/** A capture event before the recorder assigns its stable identity and order. */
export type TransportEventDraft = WithoutEventIdentity<TransportEvent>;

export type CaptureTransportProvenanceEvidence =
  | {
      transport: "udp";
      journal: UdpBridgeJournal | null;
    }
  | {
      transport: "serial";
      device: SerialTransportProvenance["device"];
      settings: SerialTransportProvenance["settings"];
    };

export interface CaptureFinalizationEvidence {
  stopDisposition?: CaptureIntegrityReceipt["stopDisposition"];
  stopOffsetUs?: number | null;
  eventLogComplete?: boolean;
  observedUnits?: number | null;
  observedBytes?: number | null;
  transportReportedUnits?: number | null;
  transportReportedBytes?: number | null;
  transportProvenance?: CaptureTransportProvenanceEvidence;
  issueCodes?: readonly CaptureIntegrityIssueCode[];
  shutdown?: {
    code: string;
    message: string;
  };
}

export type CaptureRecorderLimit = "records" | "captured-bytes" | "session-file-bytes" | "duration" | "unknown";

export class CaptureRecorderError extends Error {
  readonly limit: CaptureRecorderLimit | null;
  readonly limitValue: number | null;
  readonly observedValue: number | null;

  constructor(
    message: string,
    details: {
      limit?: CaptureRecorderLimit;
      limitValue?: number;
      observedValue?: number;
    } = {},
  ) {
    super(message);
    this.name = "CaptureRecorderError";
    this.limit = details.limit ?? null;
    this.limitValue = details.limitValue ?? null;
    this.observedValue = details.observedValue ?? null;
  }
}

// The terminal receipt is small and bounded, but reserving space up front keeps
// a late integrity failure from being crowded out by the final raw record.
const CAPTURE_INTEGRITY_RECEIPT_RESERVE_BYTES = 4_096;
// Covers the bounded 128-entry bridge journal at maximum schema text lengths,
// plus the fixed UDP/serial provenance envelope. Distinct endpoint rows are
// accounted exactly as they are first observed below.
const TRANSPORT_PROVENANCE_RESERVE_BYTES = 1 * 1024 * 1024;

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
      { limit: "duration", limitValue: maximumUs, observedValue: offsetUs },
    );
  }
}

function cloneSignal(signal: SourceRecord["signal"]): SourceRecord["signal"] {
  return signal == null ? undefined : { ...signal };
}

function cloneRemoteEndpoint(endpoint: UdpRemoteEndpoint): UdpRemoteEndpoint {
  return { ...endpoint };
}

function deepFreeze<T>(value: T): T {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function defaultCaptureIntegrity(
  transport: "udp" | "serial",
  stopOffsetUs: number,
  records: number,
  bytes: number,
): CaptureIntegrityReceipt {
  return {
    schemaVersion: 1,
    status: "verified",
    assessmentBasis: transport === "udp" ? "udp-bridge-reconciled" : "web-serial-observed",
    stopDisposition: "confirmed",
    stopOffsetUs,
    eventLogComplete: true,
    input: {
      unit: transport === "udp" ? "datagram" : "serial-read",
      observedUnits: records,
      observedBytes: bytes,
      transportReportedUnits: transport === "udp" ? records : null,
      transportReportedBytes: transport === "udp" ? bytes : null,
    },
    retained: { records, bytes },
    issueCodes: [],
  };
}

function orderedIssueCodes(values: Iterable<CaptureIntegrityIssueCode>): CaptureIntegrityIssueCode[] {
  const present = new Set(values);
  return captureIntegrityIssueCodes.filter((code) => present.has(code));
}

function orderedTransportProvenanceIssueCodes(
  values: Iterable<TransportProvenanceIssueCode>,
): TransportProvenanceIssueCode[] {
  const present = new Set(values);
  return transportProvenanceIssueCodes.filter((code) => present.has(code));
}

function udpEndpointKey(endpoint: UdpRemoteEndpoint): string {
  return JSON.stringify([endpoint.family, endpoint.address, endpoint.port]);
}

function udpByteAccounting(journal: UdpBridgeJournal | null): UdpByteAccounting | null {
  if (!journal) return null;
  const udpHeaderBytes = 8;
  const ipHeaderBytes = journal.bind.family === "IPv4" ? 20 : 40;
  const udpBytes = journal.bytes + (journal.datagrams * udpHeaderBytes);
  return {
    schemaVersion: 1,
    scope: "whole-session",
    datagrams: journal.datagrams,
    payload: {
      bytes: journal.bytes,
      basis: "observed",
      source: "udp-bridge-payload-counter",
      confidence: "exact",
    },
    udp: {
      bytes: udpBytes,
      basis: "estimated",
      source: "payload-plus-fixed-udp-header",
      confidence: "deterministic",
      headerBytesPerDatagram: udpHeaderBytes,
    },
    ip: {
      bytes: udpBytes + (journal.datagrams * ipHeaderBytes),
      basis: "minimum-estimate",
      source: "payload-plus-fixed-udp-and-ip-headers",
      confidence: "bounded-assumption",
      family: journal.bind.family,
      headerBytesPerDatagram: ipHeaderBytes,
      assumptions: [
        "no-ip-options-or-extension-headers",
        "no-fragmentation",
      ],
    },
    linkLayer: {
      bytes: null,
      basis: "unavailable",
      reason: "not-observed-at-udp-socket",
    },
    radioLayer: {
      bytes: null,
      basis: "unavailable",
      reason: "not-observed-at-udp-socket",
    },
  };
}

/**
 * Collects already-delimited UDP datagrams or serial assembly outputs into the
 * immutable session format consumed by the replay pipeline.
 */
export class CaptureRecorder {
  readonly limits: CaptureLimits;

  private readonly options: Omit<
    CaptureRecorderOptions,
    "limits" | "startedAt" | "decoder" | "decoderPack"
  > & {
    startedAt: string;
    decoder: DecoderDescriptor;
    decoderPack: DecoderPackDocument;
  };
  private readonly capturedRecords: SourceRecord[] = [];
  private readonly capturedTransportEvents: TransportEvent[] = [];
  private capturedByteCount = 0;
  private serializedRecordBytes = 0;
  private serializedTransportEventBytes = 0;
  private serializedDistinctEndpointBytes = 0;
  private readonly distinctEndpointKeys = new Set<string>();
  private lastOffsetUs = -1;
  private finalized = false;
  private eventLogComplete = true;
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
    let decoderPack: DecoderPackDocument;
    try {
      if (options.decoderPack != null) {
        decoderPack = validateDecoderPackRuntime(validateDecoderPack(options.decoderPack));
        if (options.decoder != null) {
          const generated = decoderDescriptorForPack(decoderPack);
          const descriptorCanBeUpgraded = options.decoder.id === generated.id
            && options.decoder.revision === generated.revision
            && options.decoder.schemaHash.toLowerCase() === generated.schemaHash
            && options.decoder.packHash == null
            && options.decoder.runtimeId == null
            && options.decoder.runtimeRevision == null;
          if (!descriptorCanBeUpgraded) resolveDecoderPack(options.decoder, decoderPack);
        }
      } else if (options.decoder != null) {
        decoderPack = resolveDecoderPack(options.decoder);
      } else {
        decoderPack = NSL01_DECODER_PACK;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Decoder pack is invalid.";
      throw new CaptureRecorderError(`Capture decoder configuration is invalid: ${reason}`);
    }
    const decoder = decoderDescriptorForPack(decoderPack);
    const source = { ...options.source };
    try {
      validateSessionDocument({
        format: "narrowslink/session",
        formatVersion: 2,
        id: options.sessionId,
        title: options.title,
        startedAt,
        displayTimeZone: options.displayTimeZone,
        durationUs: 1,
        source,
        decoder,
        decoderPack,
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
        transportEvents: [],
        captureIntegrity: defaultCaptureIntegrity(source.kind, 1, 1, 1),
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
      decoderPack,
    };
    this.limits = resolveLimits(options.limits);
    this.sessionFileEnvelopeBytes = sessionDocumentFileByteLength(
      this.buildDocument(
        this.limits.maxDurationUs,
        [],
        [],
        defaultCaptureIntegrity(source.kind, this.limits.maxDurationUs, 0, 0),
      ),
    );
    if (
      this.sessionFileEnvelopeBytes
      + CAPTURE_INTEGRITY_RECEIPT_RESERVE_BYTES
      + TRANSPORT_PROVENANCE_RESERVE_BYTES
      >= this.limits.maxSessionFileBytes
    ) {
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

  get transportEventCount(): number {
    return this.capturedTransportEvents.length;
  }

  /** Compact file size reserved with the configured maximum-duration digits. */
  get projectedSessionFileBytes(): number {
    return this.sessionFileEnvelopeBytes
      + this.serializedRecordBytes
      + Math.max(0, this.recordCount - 1)
      + this.serializedTransportEventBytes
      + Math.max(0, this.transportEventCount - 1)
      + this.serializedDistinctEndpointBytes
      + CAPTURE_INTEGRITY_RECEIPT_RESERVE_BYTES
      + TRANSPORT_PROVENANCE_RESERVE_BYTES;
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
        { limit: "captured-bytes", limitValue: MAX_CAPTURE_RECORD_BYTES, observedValue: input.bytes.byteLength },
      );
    }
    if (this.recordCount >= this.limits.maxRecords) {
      throw new CaptureRecorderError(
        `Capture reached its ${this.limits.maxRecords}-record limit; stop and save this session.`,
        { limit: "records", limitValue: this.limits.maxRecords, observedValue: this.recordCount + 1 },
      );
    }
    if (this.capturedByteCount + input.bytes.byteLength > this.limits.maxCapturedBytes) {
      throw new CaptureRecorderError(
        `Capture would exceed its ${this.limits.maxCapturedBytes}-byte limit; stop and save this session.`,
        {
          limit: "captured-bytes",
          limitValue: this.limits.maxCapturedBytes,
          observedValue: this.capturedByteCount + input.bytes.byteLength,
        },
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
    if (this.options.source.kind !== "udp" && input.kernelDropCounter !== undefined) {
      throw new CaptureRecorderError("Only UDP capture records may carry a kernel drop counter.");
    }
    let remoteEndpoint: UdpRemoteEndpoint | undefined;
    if (input.remoteEndpoint != null) {
      if (this.options.source.kind !== "udp") {
        throw new CaptureRecorderError("Only UDP capture records may carry a remote endpoint.");
      }
      const parsedEndpoint = udpRemoteEndpointSchema.safeParse(input.remoteEndpoint);
      if (!parsedEndpoint.success) {
        throw new CaptureRecorderError(
          `UDP remote endpoint is invalid: ${parsedEndpoint.error.issues[0]?.message ?? "unknown validation error"}`,
        );
      }
      remoteEndpoint = cloneRemoteEndpoint(parsedEndpoint.data);
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
        ...(input.kernelDropCounter === undefined ? {} : { kernelDropCounter: input.kernelDropCounter }),
        ...(remoteEndpoint == null ? {} : { remoteEndpoint: Object.freeze(remoteEndpoint) }),
      }),
      ...(input.signal == null ? {} : { signal: Object.freeze(cloneSignal(input.signal)) }),
    });
    const recordFileBytes = utf8ByteLength(JSON.stringify(record));
    const endpointKey = remoteEndpoint == null ? null : udpEndpointKey(remoteEndpoint);
    const endpointSummaryBytes = remoteEndpoint != null && endpointKey != null && !this.distinctEndpointKeys.has(endpointKey)
      ? utf8ByteLength(JSON.stringify(remoteEndpoint)) + 1
      : 0;
    const projectedFileBytes = this.projectedSessionFileBytes
      + recordFileBytes
      + endpointSummaryBytes
      + (this.recordCount > 0 ? 1 : 0);
    if (projectedFileBytes > this.limits.maxSessionFileBytes) {
      throw new CaptureRecorderError(
        `Capture would exceed its ${this.limits.maxSessionFileBytes}-byte replay-file limit after JSON and hex encoding; stop and save this session.`,
        {
          limit: "session-file-bytes",
          limitValue: this.limits.maxSessionFileBytes,
          observedValue: projectedFileBytes,
        },
      );
    }

    this.capturedRecords.push(record);
    this.capturedByteCount += input.bytes.byteLength;
    this.serializedRecordBytes += recordFileBytes;
    if (endpointKey != null && endpointSummaryBytes > 0) {
      this.distinctEndpointKeys.add(endpointKey);
      this.serializedDistinctEndpointBytes += endpointSummaryBytes;
    }
    this.lastOffsetUs = input.offsetUs;
    return record;
  }

  appendTransportEvent(input: TransportEventDraft): TransportEvent | null {
    return this.appendTransportEventWithBudget(input, false);
  }

  /**
   * Finalization evidence may consume the receipt reserve so a full capture can
   * still explain why it is incomplete. The final serialized-size check remains
   * authoritative and keeps the emitted session within the importer budget.
   */
  appendTerminalTransportEvent(input: TransportEventDraft): TransportEvent | null {
    return this.appendTransportEventWithBudget(input, true);
  }

  private appendTransportEventWithBudget(
    input: TransportEventDraft,
    mayUseReceiptReserve: boolean,
  ): TransportEvent | null {
    if (this.finalized) {
      throw new CaptureRecorderError("Capture has already stopped; transport evidence cannot be appended.");
    }
    if (this.transportEventCount >= MAX_TRANSPORT_EVENTS) {
      this.eventLogComplete = false;
      return null;
    }

    const candidate = {
      ...input,
      id: `capture-transport-event-${String(this.transportEventCount + 1).padStart(6, "0")}`,
      index: this.transportEventCount,
    };
    const parsed = transportEventSchema.safeParse(candidate);
    if (!parsed.success) {
      this.eventLogComplete = false;
      throw new CaptureRecorderError(
        `Capture transport evidence is invalid: ${parsed.error.issues[0]?.message ?? "unknown validation error"}`,
      );
    }

    const event = deepFreeze(parsed.data as TransportEvent);
    const eventBytes = utf8ByteLength(JSON.stringify(event));
    const projectedFileBytes = this.projectedSessionFileBytes
      + eventBytes
      + (this.transportEventCount > 0 ? 1 : 0);
    const evidenceBudget = this.limits.maxSessionFileBytes
      + (mayUseReceiptReserve ? CAPTURE_INTEGRITY_RECEIPT_RESERVE_BYTES : 0);
    if (projectedFileBytes > evidenceBudget) {
      this.eventLogComplete = false;
      return null;
    }

    this.capturedTransportEvents.push(event);
    this.serializedTransportEventBytes += eventBytes;
    return event;
  }

  markEventLogIncomplete(): void {
    if (this.finalized) {
      throw new CaptureRecorderError("Capture has already stopped; its event-log assessment is immutable.");
    }
    this.eventLogComplete = false;
  }

  private normalizeFinalizationEvidence(
    evidence: CaptureFinalizationEvidence | undefined,
  ): CaptureFinalizationEvidence | undefined {
    const provenance = evidence?.transportProvenance;
    if (!provenance) return evidence;
    if (provenance.transport !== this.options.source.kind) {
      throw new CaptureRecorderError(
        `Capture transport provenance uses ${provenance.transport}; recorder source uses ${this.options.source.kind}.`,
      );
    }
    if (provenance.transport === "serial") {
      return {
        ...evidence,
        transportProvenance: {
          transport: "serial",
          device: { ...provenance.device },
          settings: { ...provenance.settings },
        },
      };
    }
    if (provenance.journal === null) return evidence;

    const parsedJournal = udpBridgeJournalSchema.safeParse(provenance.journal);
    if (!parsedJournal.success) {
      throw new CaptureRecorderError(
        `UDP bridge provenance journal is invalid: ${parsedJournal.error.issues[0]?.message ?? "unknown validation error"}`,
      );
    }
    const kernelDroppedDatagrams = parsedJournal.data.kernelDroppedDatagrams;
    const kernelDropsObserved = kernelDroppedDatagrams != null && kernelDroppedDatagrams > 0;
    if (
      kernelDropsObserved
      && !this.capturedTransportEvents.some((event) => event.type === "udp-kernel-drops-observed")
    ) {
      this.appendTerminalTransportEvent({
        type: "udp-kernel-drops-observed",
        transport: "udp",
        scope: { kind: "session" },
        severity: "critical",
        message: `The host UDP socket reported ${kernelDroppedDatagrams} dropped datagrams during the capture sample window.`,
        kernelDroppedDatagrams,
        counterSource: "linux-proc-net-udp-socket",
      });
    }
    return {
      ...evidence,
      transportReportedUnits: evidence.transportReportedUnits ?? parsedJournal.data.datagrams,
      transportReportedBytes: evidence.transportReportedBytes ?? parsedJournal.data.bytes,
      issueCodes: kernelDropsObserved
        ? orderedIssueCodes([...(evidence.issueCodes ?? []), "udp-kernel-drops-observed"])
        : evidence.issueCodes,
      transportProvenance: { transport: "udp", journal: parsedJournal.data },
    };
  }

  private buildTransportProvenance(
    evidence: CaptureTransportProvenanceEvidence | undefined,
    captureIntegrity: CaptureIntegrityReceipt,
  ): TransportProvenance | undefined {
    if (!evidence) return undefined;
    if (evidence.transport === "serial") {
      const identifiersUnavailable = evidence.device.usbVendorId === null
        && evidence.device.usbProductId === null
        && evidence.device.bluetoothServiceClassId === null;
      return {
        schemaVersion: 1,
        transport: "serial",
        sourceId: this.options.source.id,
        status: "verified",
        issueCodes: identifiersUnavailable ? ["serial-device-identifiers-unavailable"] : [],
        device: { ...evidence.device },
        settings: { ...evidence.settings },
      };
    }

    const distinctEndpoints = new Map<string, UdpRemoteEndpoint>();
    let attributedRecords = 0;
    for (const record of this.capturedRecords) {
      const endpoint = record.transport.remoteEndpoint;
      if (!endpoint) continue;
      attributedRecords += 1;
      const key = udpEndpointKey(endpoint);
      if (!distinctEndpoints.has(key)) distinctEndpoints.set(key, cloneRemoteEndpoint(endpoint));
    }
    const issueValues = new Set<TransportProvenanceIssueCode>();
    const journal = evidence.journal;
    if (journal === null) {
      issueValues.add("udp-bridge-journal-unavailable");
    } else {
      if (journal.state !== "clean" || !journal.entriesComplete || journal.omittedEntries > 0) {
        issueValues.add("udp-bridge-journal-incomplete");
      }
      if (
        journal.datagrams !== this.recordCount
        || journal.bytes !== this.capturedByteCount
        || journal.datagrams !== captureIntegrity.input.transportReportedUnits
        || journal.bytes !== captureIntegrity.input.transportReportedBytes
      ) {
        issueValues.add("udp-bridge-journal-counter-mismatch");
      }
      // The current bridge states this platform boundary explicitly. It remains
      // inspectable provenance, but does not by itself make the capture incomplete.
      if (journal.kernelDroppedDatagrams === null) {
        issueValues.add("udp-kernel-drop-counter-unavailable");
      }
    }
    const unattributedRecords = this.recordCount - attributedRecords;
    if (unattributedRecords > 0) issueValues.add("udp-endpoint-attribution-incomplete");
    const issueCodes = orderedTransportProvenanceIssueCodes(issueValues);
    const incomplete = issueValues.has("udp-bridge-journal-unavailable")
      || issueValues.has("udp-bridge-journal-incomplete")
      || issueValues.has("udp-bridge-journal-counter-mismatch")
      || issueValues.has("udp-endpoint-attribution-incomplete");
    return {
      schemaVersion: 2,
      transport: "udp",
      sourceId: this.options.source.id,
      status: incomplete ? "incomplete" : "verified",
      issueCodes,
      journal,
      byteAccounting: udpByteAccounting(journal),
      endpointAttribution: {
        totalRecords: this.recordCount,
        attributedRecords,
        unattributedRecords,
        distinctEndpoints: [...distinctEndpoints.values()],
      },
    };
  }

  private addTransportProvenanceIntegrity(
    captureIntegrity: CaptureIntegrityReceipt,
    provenance: TransportProvenance | undefined,
  ): CaptureIntegrityReceipt {
    if (provenance?.status !== "incomplete") return captureIntegrity;
    return {
      ...captureIntegrity,
      status: "incomplete",
      issueCodes: orderedIssueCodes([
        ...captureIntegrity.issueCodes,
        "transport-provenance-incomplete",
      ]),
    };
  }

  private buildCaptureIntegrity(
    durationUs: number,
    evidence: CaptureFinalizationEvidence | undefined,
  ): CaptureIntegrityReceipt {
    const transport = this.options.source.kind;
    const recorderOnly = evidence == null;
    const observedUnits = recorderOnly ? null : evidence.observedUnits ?? null;
    const observedBytes = recorderOnly ? null : evidence.observedBytes ?? null;
    const transportReportedUnits = recorderOnly ? null : evidence.transportReportedUnits ?? null;
    const transportReportedBytes = recorderOnly ? null : evidence.transportReportedBytes ?? null;
    const bridgeUnitsObserved = transportReportedUnits !== null;
    const bridgeBytesObserved = transportReportedBytes !== null;
    if (transport === "udp" && bridgeUnitsObserved !== bridgeBytesObserved) {
      throw new CaptureRecorderError("UDP finalization evidence must provide both bridge counters or neither.");
    }
    if (!recorderOnly && (observedUnits === null || observedBytes === null)) {
      throw new CaptureRecorderError("Adapter finalization evidence must include observed input units and bytes.");
    }
    if (transport === "serial" && (transportReportedUnits !== null || transportReportedBytes !== null)) {
      throw new CaptureRecorderError("Web Serial finalization evidence cannot claim transport-reported counters.");
    }

    const assessmentBasis: CaptureIntegrityReceipt["assessmentBasis"] = recorderOnly
      ? "recorder-only"
      : transport === "udp"
        ? bridgeUnitsObserved ? "udp-bridge-reconciled" : "udp-browser-observed"
        : "web-serial-observed";
    const stopDisposition = recorderOnly || (assessmentBasis === "udp-browser-observed" && evidence?.stopDisposition === "confirmed")
      ? "unconfirmed"
      : evidence?.stopDisposition ?? "unconfirmed";
    const requestedStopOffsetUs = evidence?.stopOffsetUs === undefined
      ? (stopDisposition === "not-observed" ? null : durationUs)
      : evidence.stopOffsetUs;
    if (
      requestedStopOffsetUs !== null
      && (!Number.isSafeInteger(requestedStopOffsetUs) || requestedStopOffsetUs < 0 || requestedStopOffsetUs > durationUs)
    ) {
      throw new CaptureRecorderError("Capture integrity stopOffsetUs must be a safe offset within the finalized duration.");
    }

    if (recorderOnly) this.eventLogComplete = false;
    if (stopDisposition === "unconfirmed" && !this.capturedTransportEvents.some((event) => event.type === "shutdown-unconfirmed")) {
      this.appendTerminalTransportEvent({
        type: "shutdown-unconfirmed",
        transport,
        scope: { kind: "session" },
        severity: "critical",
        code: evidence?.shutdown?.code ?? (recorderOnly ? "recorder-finalization-unassessed" : "transport-stop-unconfirmed"),
        message: (evidence?.shutdown?.message ?? (recorderOnly
          ? "The recorder was finalized without adapter stop evidence; capture integrity cannot be verified."
          : "The transport did not confirm a clean stop.")).slice(0, 1_000),
      });
    }

    const udpCountersObserved = transport === "udp"
      && observedUnits !== null
      && observedBytes !== null
      && transportReportedUnits !== null
      && transportReportedBytes !== null;
    const udpCountersReconciled = transport !== "udp" || (udpCountersObserved
      && observedUnits === transportReportedUnits
      && observedBytes === transportReportedBytes
      && this.recordCount === observedUnits
      && this.capturedByteCount === observedBytes
    );
    const udpCountersMismatch = transport === "udp" && udpCountersObserved && !udpCountersReconciled;
    if (
      udpCountersMismatch
      && !this.capturedTransportEvents.some((event) => event.type === "udp-counter-mismatch")
    ) {
      this.appendTerminalTransportEvent({
        type: "udp-counter-mismatch",
        transport: "udp",
        scope: { kind: "session" },
        severity: "critical",
        message: "UDP bridge, browser, and recorder counters did not reconcile at stop.",
        bridgeDatagrams: transportReportedUnits,
        bridgeBytes: transportReportedBytes,
        browserDatagrams: observedUnits,
        browserBytes: observedBytes,
        retainedRecords: this.recordCount,
        retainedBytes: this.capturedByteCount,
      });
    }

    const serialCountersObserved = transport === "serial"
      && observedUnits !== null
      && observedBytes !== null
      && transportReportedUnits === null
      && transportReportedBytes === null;
    const serialCountersReconciled = transport !== "serial" || (serialCountersObserved && this.capturedByteCount === observedBytes);
    const serialCountersMismatch = transport === "serial" && serialCountersObserved && !serialCountersReconciled;
    if (
      serialCountersMismatch
      && !this.capturedTransportEvents.some((event) => event.type === "serial-counter-mismatch")
    ) {
      this.appendTerminalTransportEvent({
        type: "serial-counter-mismatch",
        transport: "serial",
        scope: { kind: "session" },
        severity: "critical",
        message: "Web Serial observed-byte and recorder retained-byte counters did not reconcile at stop.",
        observedReads: observedUnits,
        observedBytes,
        retainedRecords: this.recordCount,
        retainedBytes: this.capturedByteCount,
      });
    }

    const eventLogComplete = this.eventLogComplete && evidence?.eventLogComplete === true;
    const issueValues = new Set<CaptureIntegrityIssueCode>(evidence?.issueCodes ?? []);
    for (const event of this.capturedTransportEvents) issueValues.add(event.type);
    if (!eventLogComplete) issueValues.add("event-log-incomplete");
    if (udpCountersMismatch) issueValues.add("udp-counter-mismatch");
    if (serialCountersMismatch) issueValues.add("serial-counter-mismatch");
    if (stopDisposition === "unconfirmed") issueValues.add("shutdown-unconfirmed");
    const issueCodes = orderedIssueCodes(issueValues);
    const verified = !recorderOnly
      && stopDisposition === "confirmed"
      && eventLogComplete
      && (transport === "udp" ? assessmentBasis === "udp-bridge-reconciled" && udpCountersReconciled : serialCountersReconciled)
      && issueCodes.length === 0;

    return {
      schemaVersion: 1,
      status: verified ? "verified" : "incomplete",
      assessmentBasis,
      stopDisposition,
      stopOffsetUs: requestedStopOffsetUs,
      eventLogComplete,
      input: {
        unit: transport === "udp" ? "datagram" : "serial-read",
        observedUnits,
        observedBytes,
        transportReportedUnits,
        transportReportedBytes,
      },
      retained: {
        records: this.recordCount,
        bytes: this.capturedByteCount,
      },
      issueCodes,
    };
  }

  finalize(stoppedAtUs?: number, evidence?: CaptureFinalizationEvidence): SessionDocument {
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

    const normalizedEvidence = this.normalizeFinalizationEvidence(evidence);
    const initialCaptureIntegrity = this.buildCaptureIntegrity(durationUs, normalizedEvidence);
    const transportProvenance = this.buildTransportProvenance(
      normalizedEvidence?.transportProvenance,
      initialCaptureIntegrity,
    );
    const captureIntegrity = this.addTransportProvenanceIntegrity(initialCaptureIntegrity, transportProvenance);
    const document = this.buildDocument(
      durationUs,
      [...this.capturedRecords],
      [...this.capturedTransportEvents],
      captureIntegrity,
      transportProvenance,
    );

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

  private buildDocument(
    durationUs: number,
    records: SourceRecord[],
    transportEvents: TransportEvent[],
    captureIntegrity: CaptureIntegrityReceipt,
    transportProvenance?: TransportProvenance,
  ): SessionDocumentV2 {
    return {
      format: "narrowslink/session",
      formatVersion: 2,
      id: this.options.sessionId,
      title: this.options.title,
      startedAt: this.options.startedAt,
      displayTimeZone: this.options.displayTimeZone,
      durationUs,
      source: { ...this.options.source },
      decoder: { ...this.options.decoder },
      decoderPack: this.options.decoderPack,
      records,
      transportEvents,
      captureIntegrity,
      ...(transportProvenance == null ? {} : { transportProvenance }),
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
