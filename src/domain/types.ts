import { z } from "zod";

export type OffsetUs = number;

export const MAX_SESSION_DURATION_US = 24 * 60 * 60 * 1_000_000;
export const MAX_INCIDENT_TITLE_LENGTH = 240;
export const MAX_TRANSPORT_EVENTS = 10_000;

export const familyIds = [0x02, 0x17, 0x19, 0x31, 0x44] as const;
export type FamilyId = (typeof familyIds)[number];

export interface SourceDescriptor {
  id: string;
  kind: "udp" | "serial" | "file";
  label: string;
  address?: string;
  port?: number;
}

export interface DecoderDescriptor {
  id: string;
  revision: string;
  schemaHash: string;
}

export interface SourceRecord {
  id: string;
  index: number;
  sourceId: string;
  offsetUs: OffsetUs;
  dataHex: string;
  captureBytes: number;
  wireBytes: number;
  transport: {
    kind: "udp" | "serial" | "file";
    kernelDropCounter?: number;
  };
  signal?: {
    rssiDbm?: number;
    snrDb?: number;
    provenance: "gateway-sidecar" | "decoded-packet";
  };
}

export interface IncidentPreset {
  id: string;
  title: string;
  startUs: OffsetUs;
  endUs: OffsetUs;
  severity: "info" | "warning" | "critical";
}

export interface AuthoredIncidentRange extends IncidentPreset {
  createdAt: string;
  updatedAt: string;
}

interface SessionDocumentBase {
  format: "narrowslink/session";
  id: string;
  title: string;
  startedAt: string;
  displayTimeZone: string;
  durationUs: OffsetUs;
  source: SourceDescriptor;
  decoder: DecoderDescriptor;
  records: SourceRecord[];
  incidents: IncidentPreset[];
}

export interface SessionDocumentV1 extends SessionDocumentBase {
  formatVersion: 1;
}

export type TransportEventScope =
  | { kind: "point"; offsetUs: OffsetUs }
  | { kind: "interval"; startUs: OffsetUs; endUs: OffsetUs }
  | { kind: "session" };

export interface TransportEventBase {
  id: string;
  index: number;
  transport: "udp" | "serial";
  scope: TransportEventScope;
  severity: "warning" | "critical";
  message: string;
}

export type TransportEvent =
  | (TransportEventBase & {
      type: "udp-event-sequence-discontinuity";
      transport: "udp";
      scope: { kind: "point"; offsetUs: OffsetUs };
      expectedSequence: number;
      observedSequence: number;
    })
  | (TransportEventBase & {
      type: "udp-counter-mismatch";
      transport: "udp";
      scope: { kind: "session" };
      bridgeDatagrams: number;
      bridgeBytes: number;
      browserDatagrams: number;
      browserBytes: number;
      retainedRecords: number;
      retainedBytes: number;
    })
  | (TransportEventBase & {
      type: "udp-bridge-error" | "udp-event-stream-disconnected";
      transport: "udp";
      code: string;
      fatal: boolean;
    })
  | (TransportEventBase & {
      type: "capture-backpressure" | "capture-limit";
      component: "udp-prestatus-buffer" | "recorder";
      limit: "records" | "captured-bytes" | "session-file-bytes" | "duration" | "unknown";
      limitValue: number | null;
      observedValue: number | null;
    })
  | (TransportEventBase & {
      type: "serial-read-error" | "serial-disconnected" | "serial-tail-recovery-failed";
      transport: "serial";
      code: string;
    })
  | (TransportEventBase & {
      type: "serial-counter-mismatch";
      transport: "serial";
      scope: { kind: "session" };
      observedReads: number;
      observedBytes: number;
      retainedRecords: number;
      retainedBytes: number;
    })
  | (TransportEventBase & {
      type: "shutdown-unconfirmed";
      scope: { kind: "session" };
      code: string;
    });

export const captureIntegrityIssueCodes = [
  "udp-event-sequence-discontinuity",
  "udp-counter-mismatch",
  "udp-bridge-error",
  "udp-event-stream-disconnected",
  "capture-backpressure",
  "capture-limit",
  "serial-read-error",
  "serial-disconnected",
  "serial-tail-recovery-failed",
  "serial-counter-mismatch",
  "shutdown-unconfirmed",
  "duration-capped",
  "event-log-incomplete",
  "legacy-session-unassessed",
  "file-source-unassessed",
] as const;

export type CaptureIntegrityIssueCode = (typeof captureIntegrityIssueCodes)[number];

export interface CaptureIntegrityReceipt {
  schemaVersion: 1;
  status: "verified" | "incomplete" | "unknown";
  assessmentBasis:
    | "udp-bridge-reconciled"
    | "udp-browser-observed"
    | "web-serial-observed"
    | "recorder-only"
    | "file-source-unassessed"
    | "legacy-v1";
  stopDisposition: "confirmed" | "unconfirmed" | "not-observed";
  stopOffsetUs: OffsetUs | null;
  eventLogComplete: boolean;
  input: {
    unit: "datagram" | "serial-read" | "unknown";
    observedUnits: number | null;
    observedBytes: number | null;
    transportReportedUnits: number | null;
    transportReportedBytes: number | null;
  };
  retained: {
    records: number;
    bytes: number;
  };
  issueCodes: CaptureIntegrityIssueCode[];
}

export interface SessionDocumentV2 extends SessionDocumentBase {
  formatVersion: 2;
  transportEvents: TransportEvent[];
  captureIntegrity: CaptureIntegrityReceipt;
}

export type SessionDocument = SessionDocumentV1 | SessionDocumentV2;

export interface DecodedField {
  name: string;
  raw: number | string | boolean;
  value: number | string | boolean | null;
  unit?: string;
  quality: "valid" | "out-of-range" | "unavailable";
}

export type IntegrityStatus =
  | { status: "valid"; checksum: number }
  | { status: "crc-failed"; expected: number; actual: number }
  | { status: "truncated" | "invalid-length" | "unknown-family" | "unsupported-version"; reason: string };

export interface DecodedFrame {
  id: string;
  ordinal: number;
  offsetUs: OffsetUs;
  sourceRecord: SourceRecord;
  protocolVersion?: number;
  familyId?: number;
  familyName: string;
  sequence?: number;
  deviceTimeMs?: number;
  payloadLength?: number;
  integrity: IntegrityStatus;
  status: "complete" | "partial" | "invalid";
  fields: DecodedField[];
}

export interface MetricBucket {
  offsetUs: OffsetUs;
  received: number;
  missing: number;
  throughput: number;
  lossPct: number;
  rssiDbm: number | null;
  jitterMs: number | null;
  latitude: number | null;
  longitude: number | null;
  altitudeM: number | null;
  radioTempC: number | null;
  busVoltageV: number | null;
  familyCounts: Record<string, number>;
}

export interface DiagnosticEvent {
  id: string;
  type:
    | "link-degraded"
    | "loss-burst"
    | "decoder-resync"
    | "recovery"
    | "decoder-locked"
    | "crc-failure"
    | "partial-frame"
    | "capture-path-event";
  domain: "link" | "decoder" | "capture-path" | "unknown";
  severity: "info" | "warning" | "critical";
  startUs: OffsetUs;
  endUs?: OffsetUs;
  title: string;
  description: string;
  frameIds: string[];
}

export interface IncidentProjection extends IncidentPreset {
  diagnostics: DiagnosticEvent[];
  stats: {
    receivedFrames: number;
    expectedFrames: number;
    missingFrames: number;
    completePackets: number;
    lossPct: number | null;
    decodeConfidencePct: number | null;
    lowestRssiDbm: number | null;
    peakJitterMs: number | null;
    averageThroughput: number | null;
    linkAvailabilityPct: number | null;
  };
}

export interface Marker {
  id: string;
  offsetUs: OffsetUs;
  title: string;
  note: string;
  category: "field-note" | "observation" | "maintenance";
  createdAt: string;
}

export interface ParsedSession {
  document: SessionDocument;
  transportEvents: readonly TransportEvent[];
  captureIntegrity: CaptureIntegrityReceipt;
  frames: DecodedFrame[];
  buckets: MetricBucket[];
  diagnostics: DiagnosticEvent[];
  incidents: IncidentProjection[];
  framesById: Map<string, DecodedFrame>;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const wellFormedText = (schema: z.ZodString) => schema.refine(isWellFormedUnicode, {
  message: "Text contains an unpaired UTF-16 surrogate",
});

const sourceDescriptorSchema = z.object({
  id: wellFormedText(z.string().min(1).max(128)),
  kind: z.enum(["udp", "serial", "file"]),
  label: wellFormedText(z.string().min(1).max(200)),
  address: wellFormedText(z.string().max(255)).optional(),
  port: z.number().int().min(1).max(65535).optional(),
}).strict();

const decoderDescriptorSchema = z.object({
  id: wellFormedText(z.string().min(1).max(128)),
  revision: wellFormedText(z.string().min(1).max(64)),
  schemaHash: z.string().regex(/^[0-9a-fA-F]{64}$/, "Schema hash must be a 64-character SHA-256 digest"),
}).strict();

const sourceRecordSchema = z.object({
  id: wellFormedText(z.string().min(1).max(128)),
  index: z.number().int().nonnegative(),
  sourceId: wellFormedText(z.string().min(1).max(128)),
  offsetUs: z.number().int().nonnegative().safe(),
  dataHex: z.string().max(131_100).regex(/^(?:[0-9a-fA-F]{2})*$/),
  captureBytes: z.number().int().nonnegative(),
  wireBytes: z.number().int().nonnegative(),
  transport: z.object({
    kind: z.enum(["udp", "serial", "file"]),
    kernelDropCounter: z.number().int().nonnegative().optional(),
  }).strict(),
  signal: z
    .object({
      rssiDbm: z.number().finite().min(-200).max(100).optional(),
      snrDb: z.number().finite().min(-100).max(100).optional(),
      provenance: z.enum(["gateway-sidecar", "decoded-packet"]),
    })
    .strict()
    .optional(),
}).strict().superRefine((record, context) => {
  if (
    record.transport.kind !== "udp"
    && (record.dataHex.length === 0 || record.captureBytes === 0 || record.wireBytes === 0)
  ) {
    context.addIssue({
      code: "custom",
      path: ["dataHex"],
      message: "Only UDP records may represent a zero-length datagram",
    });
  }
});

const safeNonnegativeInteger = z.number().int().nonnegative().safe();
const nullableSafeNonnegativeInteger = safeNonnegativeInteger.nullable();
const transportEventIdSchema = wellFormedText(z.string().min(1).max(128));
const transportEventMessageSchema = wellFormedText(z.string().min(1).max(1_000));
const transportEventCodeSchema = wellFormedText(z.string().min(1).max(128));
const transportEventSeveritySchema = z.enum(["warning", "critical"]);
const transportEventScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("point"), offsetUs: safeNonnegativeInteger }).strict(),
  z.object({
    kind: z.literal("interval"),
    startUs: safeNonnegativeInteger,
    endUs: z.number().int().positive().safe(),
  }).strict(),
  z.object({ kind: z.literal("session") }).strict(),
]);
const transportEventBaseShape = {
  id: transportEventIdSchema,
  index: safeNonnegativeInteger,
  severity: transportEventSeveritySchema,
  message: transportEventMessageSchema,
};
const captureLimitShape = {
  ...transportEventBaseShape,
  transport: z.enum(["udp", "serial"]),
  scope: transportEventScopeSchema,
  component: z.enum(["udp-prestatus-buffer", "recorder"]),
  limit: z.enum(["records", "captured-bytes", "session-file-bytes", "duration", "unknown"]),
  limitValue: nullableSafeNonnegativeInteger,
  observedValue: nullableSafeNonnegativeInteger,
};
const udpErrorShape = {
  ...transportEventBaseShape,
  transport: z.literal("udp"),
  scope: transportEventScopeSchema,
  code: transportEventCodeSchema,
  fatal: z.boolean(),
};
const serialErrorShape = {
  ...transportEventBaseShape,
  transport: z.literal("serial"),
  scope: transportEventScopeSchema,
  code: transportEventCodeSchema,
};

export const transportEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...transportEventBaseShape,
    type: z.literal("udp-event-sequence-discontinuity"),
    transport: z.literal("udp"),
    scope: z.object({ kind: z.literal("point"), offsetUs: safeNonnegativeInteger }).strict(),
    expectedSequence: safeNonnegativeInteger,
    observedSequence: safeNonnegativeInteger,
  }).strict(),
  z.object({
    ...transportEventBaseShape,
    type: z.literal("udp-counter-mismatch"),
    transport: z.literal("udp"),
    scope: z.object({ kind: z.literal("session") }).strict(),
    bridgeDatagrams: safeNonnegativeInteger,
    bridgeBytes: safeNonnegativeInteger,
    browserDatagrams: safeNonnegativeInteger,
    browserBytes: safeNonnegativeInteger,
    retainedRecords: safeNonnegativeInteger,
    retainedBytes: safeNonnegativeInteger,
  }).strict(),
  z.object({ ...udpErrorShape, type: z.literal("udp-bridge-error") }).strict(),
  z.object({ ...udpErrorShape, type: z.literal("udp-event-stream-disconnected") }).strict(),
  z.object({ ...captureLimitShape, type: z.literal("capture-backpressure") }).strict(),
  z.object({ ...captureLimitShape, type: z.literal("capture-limit") }).strict(),
  z.object({ ...serialErrorShape, type: z.literal("serial-read-error") }).strict(),
  z.object({ ...serialErrorShape, type: z.literal("serial-disconnected") }).strict(),
  z.object({ ...serialErrorShape, type: z.literal("serial-tail-recovery-failed") }).strict(),
  z.object({
    ...transportEventBaseShape,
    type: z.literal("serial-counter-mismatch"),
    transport: z.literal("serial"),
    scope: z.object({ kind: z.literal("session") }).strict(),
    observedReads: safeNonnegativeInteger,
    observedBytes: safeNonnegativeInteger,
    retainedRecords: safeNonnegativeInteger,
    retainedBytes: safeNonnegativeInteger,
  }).strict(),
  z.object({
    ...transportEventBaseShape,
    type: z.literal("shutdown-unconfirmed"),
    transport: z.enum(["udp", "serial"]),
    scope: z.object({ kind: z.literal("session") }).strict(),
    code: transportEventCodeSchema,
  }).strict(),
]);

export const captureIntegrityReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(["verified", "incomplete", "unknown"]),
  assessmentBasis: z.enum([
    "udp-bridge-reconciled",
    "udp-browser-observed",
    "web-serial-observed",
    "recorder-only",
    "file-source-unassessed",
    "legacy-v1",
  ]),
  stopDisposition: z.enum(["confirmed", "unconfirmed", "not-observed"]),
  stopOffsetUs: nullableSafeNonnegativeInteger,
  eventLogComplete: z.boolean(),
  input: z.object({
    unit: z.enum(["datagram", "serial-read", "unknown"]),
    observedUnits: nullableSafeNonnegativeInteger,
    observedBytes: nullableSafeNonnegativeInteger,
    transportReportedUnits: nullableSafeNonnegativeInteger,
    transportReportedBytes: nullableSafeNonnegativeInteger,
  }).strict(),
  retained: z.object({
    records: safeNonnegativeInteger,
    bytes: safeNonnegativeInteger,
  }).strict(),
  issueCodes: z.array(z.enum(captureIntegrityIssueCodes)).max(captureIntegrityIssueCodes.length),
}).strict();

export const incidentPresetSchema = z
  .object({
    id: wellFormedText(z.string().min(1).max(128)),
    title: wellFormedText(z.string().min(1).max(MAX_INCIDENT_TITLE_LENGTH)),
    startUs: z.number().int().nonnegative().safe(),
    endUs: z.number().int().positive().safe(),
    severity: z.enum(["info", "warning", "critical"]),
  })
  .strict()
  .refine((incident) => incident.endUs > incident.startUs, {
    message: "Incident end must be after its start",
  });

const sessionDocumentBaseShape = {
  format: z.literal("narrowslink/session"),
  id: wellFormedText(z.string().min(1).max(128)),
  title: wellFormedText(z.string().min(1).max(240)),
  startedAt: wellFormedText(z.string().datetime({ offset: true })),
  displayTimeZone: wellFormedText(z.string().min(1).max(100)),
  durationUs: z.number().int().positive().max(MAX_SESSION_DURATION_US).safe(),
  source: sourceDescriptorSchema,
  decoder: decoderDescriptorSchema,
  records: z.array(sourceRecordSchema).min(1).max(100_000),
  incidents: z.array(incidentPresetSchema).max(100),
};

export const sessionDocumentV1Schema = z.object({
  ...sessionDocumentBaseShape,
  formatVersion: z.literal(1),
}).strict();

export const sessionDocumentV2Schema = z.object({
  ...sessionDocumentBaseShape,
  formatVersion: z.literal(2),
  transportEvents: z.array(transportEventSchema).max(MAX_TRANSPORT_EVENTS),
  captureIntegrity: captureIntegrityReceiptSchema,
}).strict();

export const sessionDocumentSchema = z.discriminatedUnion("formatVersion", [
  sessionDocumentV1Schema,
  sessionDocumentV2Schema,
]);
