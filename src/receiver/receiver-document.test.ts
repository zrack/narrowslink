import { describe, expect, it } from "vitest";

import { buildEvidenceBundle } from "../domain/bundle";
import { decoderDescriptorForPack } from "../domain/decoder-pack";
import { NMEA0183_DECODER_PACK } from "../domain/decoder";
import { parseSession } from "../domain/session";
import type {
  CaptureIntegrityReceipt,
  SessionDocumentV2,
  SourceRecord,
} from "../domain/types";
import { verifyEvidenceBundleBytes } from "../../verifier/evidence-verifier";
import { buildReceiverDocument } from "./receiver-document";

function fixtureSession(): ReturnType<typeof parseSession> {
  const fixture = NMEA0183_DECODER_PACK.fixtures[0];
  if (!fixture) throw new Error("NMEA fixture is unavailable.");
  const records: SourceRecord[] = fixture.records.map((record, index) => ({
    id: `receiver-record-${index + 1}`,
    index,
    sourceId: "receiver-file-source",
    offsetUs: record.offsetUs,
    dataHex: record.dataHex,
    captureBytes: record.dataHex.length / 2,
    wireBytes: record.dataHex.length / 2,
    transport: { kind: "file" },
  }));
  const retainedBytes = records.reduce((sum, record) => sum + record.captureBytes, 0);
  const captureIntegrity: CaptureIntegrityReceipt = {
    schemaVersion: 1,
    status: "unknown",
    assessmentBasis: "file-source-unassessed",
    stopDisposition: "not-observed",
    stopOffsetUs: null,
    eventLogComplete: false,
    input: {
      unit: "unknown",
      observedUnits: null,
      observedBytes: null,
      transportReportedUnits: null,
      transportReportedBytes: null,
    },
    retained: { records: records.length, bytes: retainedBytes },
    issueCodes: ["file-source-unassessed"],
  };
  const document: SessionDocumentV2 = {
    format: "narrowslink/session",
    formatVersion: 2,
    id: "receiver-nmea-session",
    title: "Receiver NMEA proof",
    startedAt: "2026-07-24T20:00:00.000Z",
    displayTimeZone: "America/Los_Angeles",
    durationUs: 500_000,
    source: {
      id: "receiver-file-source",
      kind: "file",
      label: "Receiver fixture",
    },
    decoder: decoderDescriptorForPack(NMEA0183_DECODER_PACK),
    decoderPack: NMEA0183_DECODER_PACK,
    records,
    incidents: [{
      id: "receiver-range",
      title: "NMEA handoff",
      severity: "warning",
      startUs: 50_000,
      endUs: 400_000,
    }],
    transportEvents: [],
    captureIntegrity,
  };
  return parseSession(document);
}

async function verifiedBundle(include?: Parameters<typeof buildEvidenceBundle>[0]["include"]) {
  const session = fixtureSession();
  const bytes = await buildEvidenceBundle({
    session,
    range: session.incidents[0]!,
    markers: [{
      id: "receiver-marker",
      offsetUs: 100_000,
      title: "Observed",
      note: "Receiver marker",
      category: "observation",
      createdAt: "2026-07-24T20:00:00.100Z",
    }],
    notes: [{
      id: "source-note",
      body: "Source-side note",
    }],
    include,
    generatedAt: "2026-07-24T20:01:00.000Z",
  });
  return verifyEvidenceBundleBytes(bytes);
}

describe("buildReceiverDocument", () => {
  it("retains the exact incident coordinates, verification claims, and included evidence", async () => {
    const receiver = buildReceiverDocument(await verifiedBundle());

    expect(receiver.incident).toEqual({
      id: "receiver-range",
      title: "NMEA handoff",
      severity: "warning",
      startUs: 50_000,
      endUs: 400_000,
      rangeSemantics: "half-open [startUs, endUs)",
    });
    expect(receiver.claims).toEqual({
      internalConsistency: "internally-consistent",
      evidenceCompleteness: "unknown",
      captureEvidence: "unknown",
      provenanceEvidence: "unknown",
      authenticity: "not-established",
    });
    expect(receiver.evidence.rawRecords).toHaveLength(1);
    expect(receiver.evidence.decodedPackets[0]?.familyName).toContain("NMEA GGA");
    expect(receiver.evidence.markers).toHaveLength(1);
    expect(receiver.evidence.sourceNotes).toHaveLength(1);
    expect(receiver.decoderPack?.integrity.canonicalSha256)
      .toBe(NMEA0183_DECODER_PACK.integrity.canonicalSha256);
    expect(receiver.availability.rawRecords).toEqual({ included: true, records: 1 });
    expect(Object.isFrozen(receiver)).toBe(true);
    expect(Object.isFrozen(receiver.decoderPack)).toBe(true);
    expect(Object.isFrozen(receiver.evidence.rawRecords)).toBe(true);
  });

  it("keeps excluded artifact groups unavailable instead of fabricating receiver context", async () => {
    const receiver = buildReceiverDocument(await verifiedBundle({
      rawRecords: false,
      diagnostics: false,
      markers: false,
      notes: false,
      schema: false,
    }));

    expect(receiver.availability.rawRecords).toEqual({ included: false, records: 0 });
    expect(receiver.availability.diagnostics).toEqual({ included: false, records: 0 });
    expect(receiver.evidence.rawRecords).toEqual([]);
    expect(receiver.evidence.diagnostics).toEqual([]);
    expect(receiver.evidence.markers).toEqual([]);
    expect(receiver.evidence.sourceNotes).toEqual([]);
    expect(receiver.limitations).toContain("Raw source records were excluded from this bundle.");
  });
});
