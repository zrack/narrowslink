import { z } from "zod";

export type OffsetUs = number;

export const MAX_SESSION_DURATION_US = 24 * 60 * 60 * 1_000_000;

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

export interface SessionDocument {
  format: "narrowslink/session";
  formatVersion: 1;
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
    | "partial-frame";
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

const incidentPresetSchema = z
  .object({
    id: wellFormedText(z.string().min(1).max(128)),
    title: wellFormedText(z.string().min(1).max(240)),
    startUs: z.number().int().nonnegative().safe(),
    endUs: z.number().int().positive().safe(),
    severity: z.enum(["info", "warning", "critical"]),
  })
  .strict()
  .refine((incident) => incident.endUs > incident.startUs, {
    message: "Incident end must be after its start",
  });

export const sessionDocumentSchema = z.object({
  format: z.literal("narrowslink/session"),
  formatVersion: z.literal(1),
  id: wellFormedText(z.string().min(1).max(128)),
  title: wellFormedText(z.string().min(1).max(240)),
  startedAt: wellFormedText(z.string().datetime({ offset: true })),
  displayTimeZone: wellFormedText(z.string().min(1).max(100)),
  durationUs: z.number().int().positive().max(MAX_SESSION_DURATION_US).safe(),
  source: sourceDescriptorSchema,
  decoder: decoderDescriptorSchema,
  records: z.array(sourceRecordSchema).min(1).max(100_000),
  incidents: z.array(incidentPresetSchema).max(100),
}).strict();
