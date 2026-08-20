import { z } from "zod";

import {
  MAX_SESSION_DURATION_US,
  captureIntegrityReceiptSchema,
  serialTransportProvenanceSchema,
  transportEventSchema,
  udpBridgeJournalSchema,
  udpTransportProvenanceSchema,
} from "./types";
import type { TransportProvenance, UdpBridgeJournal } from "./types";

export const EVIDENCE_BUNDLE_FORMAT = "narrowslink/evidence-bundle" as const;
export const EVIDENCE_BUNDLE_FORMAT_VERSION = 4 as const;
export const SUPPORTED_EVIDENCE_BUNDLE_FORMAT_VERSIONS = [3, 4] as const;
export const EVIDENCE_BUNDLE_MEDIA_TYPE = "application/vnd.narrowslink.evidence-bundle+zip" as const;
export const EVIDENCE_RANGE_SEMANTICS = "half-open [startUs, endUs)" as const;
export const EVIDENCE_SOURCE_RECORD_ID_CHARACTERS = 128 as const;
export const EVIDENCE_ENCODED_SOURCE_RECORD_ID_CHARACTERS = 129 as const;
export const EVIDENCE_FRAME_ID_CHARACTERS = 134 as const;
export const EVIDENCE_DIAGNOSTIC_ID_CHARACTERS = 192 as const;

export const EVIDENCE_ARCHIVE_LIMITS = Object.freeze({
  archiveBytes: 64 * 1024 * 1024,
  entryBytes: 64 * 1024 * 1024,
  totalUncompressedBytes: 128 * 1024 * 1024,
  entries: 16,
  jsonBytes: 16 * 1024 * 1024,
  textBytes: 64 * 1024 * 1024,
  ndjsonRecords: 100_000,
  ndjsonLineBytes: 256 * 1024,
  csvRecords: 100_000,
  csvCellCharacters: 1_000_000,
} as const);

export const EVIDENCE_ARTIFACT_PATHS = [
  "decoded/packets.csv",
  "diagnostics/diagnostics.csv",
  "diagnostics/diagnostics.json",
  "markers/markers.json",
  "notes/notes.json",
  "raw/source-records.ndjson",
  "schema/schema.json",
  "transport/events.json",
  "transport/integrity-receipt.json",
  "transport/journal.json",
  "transport/provenance.json",
] as const;

export type EvidenceArtifactPath = (typeof EVIDENCE_ARTIFACT_PATHS)[number];

export const EVIDENCE_ARCHIVE_PATHS = ["SHA256SUMS", "manifest.json", ...EVIDENCE_ARTIFACT_PATHS] as const;
export type EvidenceArchivePath = (typeof EVIDENCE_ARCHIVE_PATHS)[number];

export const MANDATORY_EVIDENCE_ARTIFACT_PATHS = [
  "transport/events.json",
  "transport/integrity-receipt.json",
  "transport/journal.json",
  "transport/provenance.json",
] as const satisfies readonly EvidenceArtifactPath[];

export const OPTIONAL_EVIDENCE_ARTIFACT_GROUPS = Object.freeze({
  rawRecords: ["raw/source-records.ndjson"],
  decodedPackets: ["decoded/packets.csv"],
  diagnostics: ["diagnostics/diagnostics.csv", "diagnostics/diagnostics.json"],
  markers: ["markers/markers.json"],
  notes: ["notes/notes.json"],
  schema: ["schema/schema.json"],
} as const satisfies Record<string, readonly EvidenceArtifactPath[]>);

export const EVIDENCE_ARTIFACT_MEDIA_TYPES: Readonly<Record<EvidenceArtifactPath, string>> = Object.freeze({
  "decoded/packets.csv": "text/csv; charset=utf-8",
  "diagnostics/diagnostics.csv": "text/csv; charset=utf-8",
  "diagnostics/diagnostics.json": "application/json",
  "markers/markers.json": "application/json",
  "notes/notes.json": "application/json",
  "raw/source-records.ndjson": "application/x-ndjson",
  "schema/schema.json": "application/json",
  "transport/events.json": "application/json",
  "transport/integrity-receipt.json": "application/json",
  "transport/journal.json": "application/json",
  "transport/provenance.json": "application/json",
});

const safeNonnegativeInteger = z.number().int().nonnegative().safe();
const boundedText = (maximum: number) => z.string().min(1).max(maximum);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const sourceKindSchema = z.enum(["udp", "serial", "file"]);
const unavailableReasonSchema = z.enum(["legacy-v1", "pre-provenance-v2", "journal-unavailable", "not-applicable"]);

export const evidenceRangeSchema = z.object({
  startUs: safeNonnegativeInteger,
  endUs: z.number().int().positive().safe(),
}).strict();

export const evidenceMarkerSchema = z.object({
  id: boundedText(128),
  offsetUs: safeNonnegativeInteger,
  title: boundedText(240),
  note: z.string().max(20_000),
  category: z.enum(["field-note", "observation", "maintenance"]),
  createdAt: z.string().max(64).datetime({ offset: true }),
}).strict();

export const evidenceMarkersDocumentSchema = z.object({
  range: evidenceRangeSchema,
  markers: z.array(evidenceMarkerSchema).max(100_000),
}).strict();
export type EvidenceMarker = z.infer<typeof evidenceMarkerSchema>;

export const evidenceNoteSchema = z.object({
  id: boundedText(128),
  offsetUs: safeNonnegativeInteger.optional(),
  title: boundedText(240).optional(),
  body: z.string().min(1).max(100_000),
  createdAt: z.string().max(64).datetime({ offset: true }).optional(),
}).strict();

export const evidenceNotesDocumentSchema = z.object({
  range: evidenceRangeSchema,
  notes: z.array(evidenceNoteSchema).max(100_000),
}).strict();
export type EvidenceNote = z.infer<typeof evidenceNoteSchema>;

export const evidenceDiagnosticSchema = z.object({
  id: boundedText(EVIDENCE_DIAGNOSTIC_ID_CHARACTERS),
  type: z.enum([
    "link-degraded",
    "loss-burst",
    "decoder-resync",
    "recovery",
    "decoder-locked",
    "crc-failure",
    "checksum-failure",
    "partial-frame",
    "capture-path-event",
  ]),
  domain: z.enum(["link", "decoder", "capture-path", "unknown"]),
  severity: z.enum(["info", "warning", "critical"]),
  startUs: safeNonnegativeInteger,
  endUs: safeNonnegativeInteger.optional(),
  title: boundedText(240),
  description: boundedText(4_000),
  frameIds: z.array(boundedText(EVIDENCE_FRAME_ID_CHARACTERS)).max(100_000),
}).strict();

export const evidenceDiagnosticsDocumentSchema = z.object({
  range: evidenceRangeSchema,
  diagnostics: z.array(evidenceDiagnosticSchema).max(100_000),
}).strict();
export type EvidenceDiagnostic = z.infer<typeof evidenceDiagnosticSchema>;

export const evidenceBundleInclusionsSchema = z.object({
  rawRecords: z.boolean(),
  decodedPackets: z.boolean(),
  diagnostics: z.boolean(),
  markers: z.boolean(),
  notes: z.boolean(),
  schema: z.boolean(),
  transportEvidence: z.literal(true),
}).strict();

export type EvidenceBundleInclusions = z.infer<typeof evidenceBundleInclusionsSchema>;

export const evidenceBundleArtifactSchema = z.object({
  path: z.enum(EVIDENCE_ARTIFACT_PATHS),
  mediaType: boundedText(128),
  bytes: safeNonnegativeInteger.max(EVIDENCE_ARCHIVE_LIMITS.entryBytes),
  sha256: sha256Schema,
  recordCount: safeNonnegativeInteger.max(100_000).optional(),
}).strict();

export type EvidenceBundleArtifact = z.infer<typeof evidenceBundleArtifactSchema>;

export type EvidenceTransportUnavailableReason = z.infer<typeof unavailableReasonSchema>;

const availableProvenanceDocumentSchema = z.object({
  format: z.literal("narrowslink/transport-provenance"),
  formatVersion: z.union([z.literal(1), z.literal(2)]),
  availability: z.literal("available"),
  sessionFormatVersion: z.literal(2),
  sourceId: boundedText(128),
  transport: z.enum(["udp", "serial"]),
  provenance: z.union([udpTransportProvenanceSchema, serialTransportProvenanceSchema]),
}).strict().superRefine((document, context) => {
  const expectedFormatVersion = document.provenance.transport === "udp"
    && document.provenance.schemaVersion === 2
    ? 2
    : 1;
  if (document.formatVersion !== expectedFormatVersion) {
    context.addIssue({
      code: "custom",
      path: ["formatVersion"],
      message: "Transport-provenance document version does not match its nested provenance contract.",
    });
  }
});

const unavailableProvenanceDocumentSchema = z.object({
  format: z.literal("narrowslink/transport-provenance"),
  formatVersion: z.literal(1),
  availability: z.literal("unavailable"),
  reason: z.enum(["legacy-v1", "pre-provenance-v2"]),
  sessionFormatVersion: z.union([z.literal(1), z.literal(2)]),
  sourceId: boundedText(128),
  transport: sourceKindSchema,
  provenance: z.null(),
}).strict();

export const evidenceTransportProvenanceDocumentSchema = z.discriminatedUnion("availability", [
  availableProvenanceDocumentSchema,
  unavailableProvenanceDocumentSchema,
]);

export type EvidenceTransportProvenanceDocument =
  | {
      format: "narrowslink/transport-provenance";
      formatVersion: 1 | 2;
      availability: "available";
      sessionFormatVersion: 2;
      sourceId: string;
      transport: "udp" | "serial";
      provenance: TransportProvenance;
    }
  | {
      format: "narrowslink/transport-provenance";
      formatVersion: 1;
      availability: "unavailable";
      reason: "legacy-v1" | "pre-provenance-v2";
      sessionFormatVersion: 1 | 2;
      sourceId: string;
      transport: "udp" | "serial" | "file";
      provenance: null;
    };

const availableJournalDocumentSchema = z.object({
  format: z.literal("narrowslink/transport-journal"),
  formatVersion: z.literal(1),
  availability: z.literal("available"),
  sessionFormatVersion: z.literal(2),
  sourceId: boundedText(128),
  transport: z.literal("udp"),
  captureId: boundedText(128),
  journal: udpBridgeJournalSchema,
}).strict();

const unavailableJournalDocumentSchema = z.object({
  format: z.literal("narrowslink/transport-journal"),
  formatVersion: z.literal(1),
  availability: z.literal("unavailable"),
  reason: unavailableReasonSchema,
  sessionFormatVersion: z.union([z.literal(1), z.literal(2)]),
  sourceId: boundedText(128),
  transport: sourceKindSchema,
  captureId: z.null(),
  journal: z.null(),
}).strict();

export const evidenceTransportJournalDocumentSchema = z.discriminatedUnion("availability", [
  availableJournalDocumentSchema,
  unavailableJournalDocumentSchema,
]);

export type EvidenceTransportJournalDocument =
  | {
      format: "narrowslink/transport-journal";
      formatVersion: 1;
      availability: "available";
      sessionFormatVersion: 2;
      sourceId: string;
      transport: "udp";
      captureId: string;
      journal: UdpBridgeJournal;
    }
  | {
      format: "narrowslink/transport-journal";
      formatVersion: 1;
      availability: "unavailable";
      reason: EvidenceTransportUnavailableReason;
      sessionFormatVersion: 1 | 2;
      sourceId: string;
      transport: "udp" | "serial" | "file";
      captureId: null;
      journal: null;
    };

export const evidenceBundleProvenanceSummarySchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  status: z.enum(["verified", "incomplete", "unknown"]),
  sourceId: boundedText(128),
  transport: sourceKindSchema,
  issueCodes: z.array(boundedText(128)).max(32),
  captureId: boundedText(128).nullable(),
  endpointAttribution: z.object({
    totalRecords: safeNonnegativeInteger.max(100_000),
    attributedRecords: safeNonnegativeInteger.max(100_000),
    unattributedRecords: safeNonnegativeInteger.max(100_000),
    distinctEndpointCount: safeNonnegativeInteger.max(100_000),
  }).strict().nullable(),
  journal: z.object({
    availability: z.enum(["available", "unavailable"]),
    reason: unavailableReasonSchema.nullable(),
    state: z.enum(["active", "clean", "incomplete"]).nullable(),
    entriesComplete: z.boolean().nullable(),
    entryCount: safeNonnegativeInteger.max(128),
    omittedEntries: safeNonnegativeInteger,
  }).strict(),
}).strict();

export type EvidenceBundleProvenanceSummary = z.infer<typeof evidenceBundleProvenanceSummarySchema>;

export const evidenceBundleManifestSchema = z.object({
  format: z.literal(EVIDENCE_BUNDLE_FORMAT),
  formatVersion: z.union([
    z.literal(SUPPORTED_EVIDENCE_BUNDLE_FORMAT_VERSIONS[0]),
    z.literal(SUPPORTED_EVIDENCE_BUNDLE_FORMAT_VERSIONS[1]),
  ]),
  generatedAt: z.string().max(64).datetime({ offset: true }),
  session: z.object({
    id: boundedText(128),
    title: boundedText(240),
    formatVersion: z.union([z.literal(1), z.literal(2)]),
    durationUs: z.number().int().positive().max(MAX_SESSION_DURATION_US).safe(),
    startedAt: z.string().max(64).datetime({ offset: true }),
    displayTimeZone: boundedText(100),
    sourceId: boundedText(128),
    decoderId: boundedText(128),
    decoderRevision: boundedText(64),
    schemaHash: sha256Schema,
    packHash: sha256Schema.optional(),
    runtimeId: z.enum(["nsl01-binary-v1", "nmea0183-line-v1"]).optional(),
    runtimeRevision: z.literal("1").optional(),
    captureIntegrity: captureIntegrityReceiptSchema,
  }).strict().superRefine((session, context) => {
    const identityFields = [session.packHash, session.runtimeId, session.runtimeRevision];
    const present = identityFields.filter((value) => value != null).length;
    if (present !== 0 && present !== identityFields.length) {
      context.addIssue({
        code: "custom",
        message: "Decoder pack and runtime identity fields must be declared together.",
      });
    }
  }),
  provenance: evidenceBundleProvenanceSummarySchema,
  selection: z.object({
    id: boundedText(128).nullable(),
    title: boundedText(240).nullable(),
    severity: z.enum(["info", "warning", "critical"]).nullable(),
    startUs: safeNonnegativeInteger,
    endUs: z.number().int().positive().safe(),
    rangeSemantics: z.literal(EVIDENCE_RANGE_SEMANTICS),
  }).strict(),
  inclusions: evidenceBundleInclusionsSchema,
  artifacts: z.array(evidenceBundleArtifactSchema).min(4).max(EVIDENCE_ARTIFACT_PATHS.length),
  checksums: z.object({
    algorithm: z.literal("SHA-256"),
    path: z.literal("SHA256SUMS"),
    covers: z.array(z.enum(["manifest.json", ...EVIDENCE_ARTIFACT_PATHS])).min(5).max(12),
  }).strict(),
}).strict();

export type EvidenceBundleManifest = z.infer<typeof evidenceBundleManifestSchema>;

export const evidenceTransportEventsDocumentSchema = z.object({
  range: z.object({
    startUs: safeNonnegativeInteger,
    endUs: z.number().int().positive().safe(),
    rangeSemantics: z.literal(EVIDENCE_RANGE_SEMANTICS),
  }).strict(),
  events: z.array(transportEventSchema).max(10_000),
}).strict();

export type EvidenceTransportEventsDocument = z.infer<typeof evidenceTransportEventsDocumentSchema>;
