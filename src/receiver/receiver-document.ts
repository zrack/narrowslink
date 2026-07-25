import type {
  EvidenceDiagnostic,
  EvidenceMarker,
  EvidenceNote,
  EvidenceTransportJournalDocument,
  EvidenceTransportProvenanceDocument,
} from "../domain/evidence-contract";
import type {
  CaptureIntegrityReceipt,
  SourceRecord,
  TransportEvent,
} from "../domain/types";
import type { DecoderPackDocument } from "../domain/decoder-pack";
import type {
  EvidenceVerificationReport,
  VerifiedDecodedPacket,
  VerifiedEvidenceBundle,
} from "../../verifier/evidence-verifier";

export type ReceiverEvidenceGroup =
  | "rawRecords"
  | "decodedPackets"
  | "diagnostics"
  | "markers"
  | "notes"
  | "schema"
  | "transportEvidence";

export interface ReceiverEvidenceAvailability {
  included: boolean;
  records: number;
}

export interface ReceiverDocument {
  format: "narrowslink/receiver-document";
  formatVersion: 1;
  bundle: {
    bytes: number;
    sha256: string;
  };
  sourceSession: {
    id: string;
    title: string;
    formatVersion: 1 | 2;
    startedAt: string;
    durationUs: number;
    displayTimeZone: string;
    sourceId: string;
    decoderId: string;
    decoderRevision: string;
    schemaHash: string;
    packHash: string | null;
    runtimeId: string | null;
    runtimeRevision: string | null;
  };
  incident: {
    id: string | null;
    title: string | null;
    severity: "info" | "warning" | "critical" | null;
    startUs: number;
    endUs: number;
    rangeSemantics: "half-open [startUs, endUs)";
  };
  claims: {
    internalConsistency: EvidenceVerificationReport["integrity"];
    evidenceCompleteness: EvidenceVerificationReport["evidence"];
    captureEvidence: EvidenceVerificationReport["captureEvidence"];
    provenanceEvidence: EvidenceVerificationReport["provenanceEvidence"];
    authenticity: EvidenceVerificationReport["authenticity"];
  };
  decoderPack: DecoderPackDocument | null;
  availability: Record<ReceiverEvidenceGroup, ReceiverEvidenceAvailability>;
  evidence: {
    rawRecords: readonly SourceRecord[];
    decodedPackets: readonly VerifiedDecodedPacket[];
    diagnostics: readonly EvidenceDiagnostic[];
    markers: readonly EvidenceMarker[];
    sourceNotes: readonly EvidenceNote[];
    transportEvents: readonly TransportEvent[];
    integrityReceipt: CaptureIntegrityReceipt;
    transportProvenance: EvidenceTransportProvenanceDocument;
    transportJournal: EvidenceTransportJournalDocument;
  };
  limitations: readonly string[];
}

function deepFreeze<T>(value: T): T {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function availability(
  included: boolean,
  records: number,
): ReceiverEvidenceAvailability {
  return { included, records };
}

export function buildReceiverDocument(
  verified: VerifiedEvidenceBundle,
): ReceiverDocument {
  const { manifest, report } = verified;
  const document: ReceiverDocument = {
    format: "narrowslink/receiver-document",
    formatVersion: 1,
    bundle: { ...report.bundle },
    sourceSession: {
      id: manifest.session.id,
      title: manifest.session.title,
      formatVersion: manifest.session.formatVersion,
      startedAt: manifest.session.startedAt,
      durationUs: manifest.session.durationUs,
      displayTimeZone: manifest.session.displayTimeZone,
      sourceId: manifest.session.sourceId,
      decoderId: manifest.session.decoderId,
      decoderRevision: manifest.session.decoderRevision,
      schemaHash: manifest.session.schemaHash,
      packHash: manifest.session.packHash ?? null,
      runtimeId: manifest.session.runtimeId ?? null,
      runtimeRevision: manifest.session.runtimeRevision ?? null,
    },
    incident: { ...manifest.selection },
    claims: {
      internalConsistency: report.integrity,
      evidenceCompleteness: report.evidence,
      captureEvidence: report.captureEvidence,
      provenanceEvidence: report.provenanceEvidence,
      authenticity: report.authenticity,
    },
    decoderPack: verified.decoderPack,
    availability: {
      rawRecords: availability(manifest.inclusions.rawRecords, verified.rawRecords.length),
      decodedPackets: availability(manifest.inclusions.decodedPackets, verified.decodedPackets.length),
      diagnostics: availability(manifest.inclusions.diagnostics, verified.diagnostics.length),
      markers: availability(manifest.inclusions.markers, verified.markers.length),
      notes: availability(manifest.inclusions.notes, verified.notes.length),
      schema: availability(manifest.inclusions.schema, manifest.inclusions.schema ? 1 : 0),
      transportEvidence: availability(true, verified.transportEvents.length),
    },
    evidence: {
      rawRecords: verified.rawRecords,
      decodedPackets: verified.decodedPackets,
      diagnostics: verified.diagnostics,
      markers: verified.markers,
      sourceNotes: verified.notes,
      transportEvents: verified.transportEvents,
      integrityReceipt: verified.integrityReceipt,
      transportProvenance: verified.transportProvenance,
      transportJournal: verified.transportJournal,
    },
    limitations: [...report.warnings],
  };
  return deepFreeze(document);
}
