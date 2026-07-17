import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  buildEvidenceBundle,
  suggestEvidenceBundleFilename,
  type EvidenceBundleInclusions,
  type EvidenceBundleManifest,
  type EvidenceNote,
  type EvidenceRange,
} from "./bundle";
import { bytesToHex, encodeFrame, SUPPORTED_DECODER } from "./decoder";
import { parseSession } from "./session";
import type {
  CaptureIntegrityReceipt,
  DiagnosticEvent,
  Marker,
  ParsedSession,
  SessionDocumentV2,
  SourceRecord,
  TransportEvent,
} from "./types";

function sourceRecord(id: string, index: number, offsetUs: number): SourceRecord {
  const bytes = encodeFrame({
    familyId: 0x02,
    sequence: index,
    deviceTimeMs: Math.floor(offsetUs / 1_000),
    payload: new Uint8Array(8),
  });
  return {
    id,
    index,
    sourceId: "gateway-1",
    offsetUs,
    dataHex: bytesToHex(bytes),
    captureBytes: bytes.byteLength,
    wireBytes: bytes.byteLength,
    transport: { kind: "udp", kernelDropCounter: 0 },
    signal: { rssiDbm: -72, snrDb: 11, provenance: "gateway-sidecar" },
  };
}

function marker(id: string, offsetUs: number): Marker {
  return {
    id,
    offsetUs,
    title: `Marker ${id}`,
    note: `Marker note ${id}`,
    category: "observation",
    createdAt: "2026-07-16T05:00:00.000Z",
  };
}

function makeSession(options: { insideOffsetUs?: number } = {}): ParsedSession {
  const records = [
    sourceRecord("record-before", 0, 999),
    sourceRecord("record-start", 1, 1_000),
    sourceRecord("record-inside", 2, options.insideOffsetUs ?? 1_999),
    sourceRecord("record-end", 3, 2_000),
  ];
  const retainedBytes = records.reduce((total, record) => total + record.captureBytes, 0);
  const bridgeDatagrams = records.length + 1;
  const bridgeBytes = retainedBytes + (records[0]?.captureBytes ?? 1);
  const transportEvents: TransportEvent[] = [
    {
      id: "transport-ends-at-start",
      index: 0,
      type: "udp-bridge-error",
      transport: "udp",
      scope: { kind: "interval", startUs: 500, endUs: 1_000 },
      severity: "warning",
      message: "Ends exactly at the selected start",
      code: "bridge-warning",
      fatal: false,
    },
    {
      id: "transport-overlaps-start",
      index: 1,
      type: "udp-bridge-error",
      transport: "udp",
      scope: { kind: "interval", startUs: 500, endUs: 1_001 },
      severity: "critical",
      message: "Overlaps the selected start",
      code: "bridge-failed",
      fatal: true,
    },
    {
      id: "transport-before",
      index: 2,
      type: "udp-event-sequence-discontinuity",
      transport: "udp",
      scope: { kind: "point", offsetUs: 999 },
      severity: "warning",
      message: "Before the selected range",
      expectedSequence: 1,
      observedSequence: 2,
    },
    {
      id: "transport-start",
      index: 3,
      type: "udp-event-sequence-discontinuity",
      transport: "udp",
      scope: { kind: "point", offsetUs: 1_000 },
      severity: "warning",
      message: "At the selected start",
      expectedSequence: 3,
      observedSequence: 4,
    },
    {
      id: "transport-inside",
      index: 4,
      type: "udp-event-sequence-discontinuity",
      transport: "udp",
      scope: { kind: "point", offsetUs: 1_999 },
      severity: "warning",
      message: "Inside the selected range",
      expectedSequence: 5,
      observedSequence: 6,
    },
    {
      id: "transport-end",
      index: 5,
      type: "udp-event-sequence-discontinuity",
      transport: "udp",
      scope: { kind: "point", offsetUs: 2_000 },
      severity: "warning",
      message: "At the excluded end",
      expectedSequence: 7,
      observedSequence: 8,
    },
    {
      id: "transport-session",
      index: 6,
      type: "udp-counter-mismatch",
      transport: "udp",
      scope: { kind: "session" },
      severity: "critical",
      message: "Whole-session counter mismatch",
      bridgeDatagrams,
      bridgeBytes,
      browserDatagrams: records.length,
      browserBytes: retainedBytes,
      retainedRecords: records.length,
      retainedBytes,
    },
  ];
  const captureIntegrity: CaptureIntegrityReceipt = {
    schemaVersion: 1,
    status: "incomplete",
    assessmentBasis: "udp-bridge-reconciled",
    stopDisposition: "confirmed",
    stopOffsetUs: 3_000,
    eventLogComplete: true,
    input: {
      unit: "datagram",
      observedUnits: records.length,
      observedBytes: retainedBytes,
      transportReportedUnits: bridgeDatagrams,
      transportReportedBytes: bridgeBytes,
    },
    retained: { records: records.length, bytes: retainedBytes },
    issueCodes: ["udp-event-sequence-discontinuity", "udp-bridge-error", "udp-counter-mismatch"],
  };
  const document: SessionDocumentV2 = {
    format: "narrowslink/session",
    formatVersion: 2,
    id: "Harbor Relay / 07",
    title: "Harbor Relay Session 07",
    startedAt: "2026-07-16T04:38:12.000Z",
    displayTimeZone: "America/Los_Angeles",
    durationUs: 3_000,
    source: { id: "gateway-1", kind: "udp", label: "Gateway 1", address: "127.0.0.1", port: 9120 },
    decoder: { ...SUPPORTED_DECODER },
    records,
    incidents: [],
    transportEvents,
    captureIntegrity,
  };
  return parseSession(document);
}

function decodeText(archive: Record<string, Uint8Array>, path: string): string {
  const bytes = archive[path];
  if (!bytes) throw new Error(`Missing ${path}`);
  return strFromU8(bytes);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const range: EvidenceRange = {
  id: "link-fade",
  title: "Link fade",
  severity: "critical",
  startUs: 1_000,
  endUs: 2_000,
};

describe("buildEvidenceBundle", () => {
  it("writes a verifiable archive filtered with exact half-open range semantics", async () => {
    const session = makeSession();
    const markers = [
      marker("marker-before", 999),
      marker("marker-start", 1_000),
      marker("marker-inside", 1_999),
      marker("marker-end", 2_000),
    ];
    const notes: EvidenceNote[] = [
      { id: "general", body: "Applies to the complete selection." },
      { id: "before", offsetUs: 999, body: "Before" },
      { id: "start", offsetUs: 1_000, body: "At start" },
      { id: "inside", offsetUs: 1_999, body: "Inside" },
      { id: "end", offsetUs: 2_000, body: "At excluded end" },
    ];

    const bytes = await buildEvidenceBundle({
      session,
      range,
      markers,
      notes,
      generatedAt: "2026-07-16T06:00:00.000Z",
    });
    const archive = unzipSync(bytes);

    expect(Object.keys(archive).sort()).toEqual([
      "SHA256SUMS",
      "decoded/packets.csv",
      "diagnostics/diagnostics.csv",
      "diagnostics/diagnostics.json",
      "manifest.json",
      "markers/markers.json",
      "notes/notes.json",
      "raw/source-records.ndjson",
      "schema/schema.json",
      "transport/events.json",
      "transport/integrity-receipt.json",
    ]);

    const rawIds = decodeText(archive, "raw/source-records.ndjson")
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as SourceRecord).id);
    expect(rawIds).toEqual(["record-start", "record-inside"]);

    const decodedCsv = decodeText(archive, "decoded/packets.csv");
    expect(decodedCsv).toContain("frame-record-start");
    expect(decodedCsv).toContain("frame-record-inside");
    expect(decodedCsv).not.toContain("frame-record-before");
    expect(decodedCsv).not.toContain("frame-record-end");
    expect(decodedCsv).toContain("integrity_json");

    const schemaDocument = JSON.parse(decodeText(archive, "schema/schema.json")) as {
      decoder: { families: Record<string, { payloadBytes: number; fields: Array<{ name: string; offset: number; type: string }> }> };
    };
    expect(schemaDocument.decoder.families["0x31"]).toMatchObject({ payloadBytes: 24 });
    expect(schemaDocument.decoder.families["0x31"]?.fields.find((field) => field.name === "latitude")).toMatchObject({ offset: 0, type: "int32" });

    const diagnosticDocument = JSON.parse(decodeText(archive, "diagnostics/diagnostics.json")) as {
      diagnostics: DiagnosticEvent[];
    };
    expect(diagnosticDocument.diagnostics.map((item) => item.id)).toEqual([
      "transport-transport-session",
      "transport-transport-overlaps-start",
      "transport-transport-start",
      "transport-transport-inside",
    ]);

    const transportDocument = JSON.parse(decodeText(archive, "transport/events.json")) as {
      range: { startUs: number; endUs: number; rangeSemantics: string };
      events: TransportEvent[];
    };
    expect(transportDocument.range).toEqual({
      startUs: 1_000,
      endUs: 2_000,
      rangeSemantics: "half-open [startUs, endUs)",
    });
    expect(transportDocument.events.map((event) => event.id)).toEqual([
      "transport-overlaps-start",
      "transport-start",
      "transport-inside",
      "transport-session",
    ]);

    const integrityReceipt = JSON.parse(decodeText(archive, "transport/integrity-receipt.json")) as CaptureIntegrityReceipt;
    expect(integrityReceipt).toEqual(session.captureIntegrity);
    expect(integrityReceipt.input.transportReportedUnits).not.toBe(integrityReceipt.input.observedUnits);
    expect(integrityReceipt.input.transportReportedBytes).not.toBe(integrityReceipt.input.observedBytes);

    const markerDocument = JSON.parse(decodeText(archive, "markers/markers.json")) as { markers: Marker[] };
    expect(markerDocument.markers.map((item) => item.id)).toEqual(["marker-start", "marker-inside"]);

    const noteDocument = JSON.parse(decodeText(archive, "notes/notes.json")) as { notes: EvidenceNote[] };
    expect(noteDocument.notes.map((item) => item.id)).toEqual(["general", "start", "inside"]);

    const manifest = JSON.parse(decodeText(archive, "manifest.json")) as EvidenceBundleManifest;
    expect(manifest.format).toBe("narrowslink/evidence-bundle");
    expect(manifest.formatVersion).toBe(2);
    expect(manifest.session.captureIntegrity).toEqual(session.captureIntegrity);
    expect(manifest.inclusions.transportEvidence).toBe(true);
    expect(manifest.selection).toMatchObject({
      id: "link-fade",
      startUs: 1_000,
      endUs: 2_000,
      rangeSemantics: "half-open [startUs, endUs)",
    });
    expect(manifest.artifacts.find((item) => item.path === "raw/source-records.ndjson")?.recordCount).toBe(2);
    expect(manifest.artifacts.find((item) => item.path === "markers/markers.json")?.recordCount).toBe(2);
    expect(manifest.artifacts.find((item) => item.path === "transport/events.json")?.recordCount).toBe(4);
    expect(manifest.artifacts.find((item) => item.path === "transport/integrity-receipt.json")?.recordCount).toBe(1);

    const checksumLines = new Map(
      decodeText(archive, "SHA256SUMS")
        .trim()
        .split("\n")
        .map((line) => {
          const [hash, path] = line.split("  ");
          return [path, hash];
        }),
    );
    for (const path of manifest.checksums.covers) {
      const entry = archive[path];
      expect(entry, path).toBeDefined();
      if (entry) expect(checksumLines.get(path)).toBe(await sha256(entry));
    }
  });

  it("honors inclusion flags and lists only files actually present", async () => {
    const bytes = await buildEvidenceBundle({
      session: makeSession(),
      range,
      include: {
        rawRecords: false,
        decodedPackets: false,
        diagnostics: false,
        markers: false,
        notes: false,
        schema: false,
        transportEvidence: false,
      } as unknown as Partial<EvidenceBundleInclusions>,
      generatedAt: "2026-07-16T06:00:00.000Z",
    });
    const archive = unzipSync(bytes);
    expect(Object.keys(archive).sort()).toEqual([
      "SHA256SUMS",
      "manifest.json",
      "transport/events.json",
      "transport/integrity-receipt.json",
    ]);
    const manifest = JSON.parse(decodeText(archive, "manifest.json")) as EvidenceBundleManifest;
    expect(manifest.inclusions.transportEvidence).toBe(true);
    expect(manifest.artifacts.map((artifact) => artifact.path)).toEqual([
      "transport/events.json",
      "transport/integrity-receipt.json",
    ]);
    expect(manifest.checksums.covers).toEqual([
      "manifest.json",
      "transport/events.json",
      "transport/integrity-receipt.json",
    ]);
  });

  it("produces stable bytes when generatedAt and inputs are stable", async () => {
    const options = {
      session: makeSession(),
      range,
      generatedAt: "2026-07-16T06:00:00.000Z",
    } as const;
    const first = await buildEvidenceBundle(options);
    const second = await buildEvidenceBundle(options);
    expect(second).toEqual(first);
  });

  it("preserves capture index order for records sharing a timestamp", async () => {
    const session = makeSession({ insideOffsetUs: 1_000 });

    const bytes = await buildEvidenceBundle({ session, range, generatedAt: "2026-07-16T06:00:00.000Z" });
    const archive = unzipSync(bytes);
    const ids = decodeText(archive, "raw/source-records.ndjson").trim().split("\n").map((line) => (JSON.parse(line) as SourceRecord).id);

    expect(ids).toEqual(["record-start", "record-inside"]);
  });

  it("uses locale-independent code-unit ordering for equal-time evidence IDs", async () => {
    const bytes = await buildEvidenceBundle({
      session: makeSession(),
      range,
      markers: [marker("ä", 1_500), marker("z", 1_500)],
      generatedAt: "2026-07-16T06:00:00.000Z",
    });
    const archive = unzipSync(bytes);
    const markerDocument = JSON.parse(decodeText(archive, "markers/markers.json")) as { markers: Marker[] };

    expect(markerDocument.markers.map((item) => item.id)).toEqual(["z", "ä"]);
  });

  it("exports complete integrity detail for invalid decoded frames", async () => {
    const session = makeSession();
    const selectedFrame = session.frames[1];
    if (!selectedFrame) throw new Error("Expected selected fixture frame");
    selectedFrame.status = "invalid";
    selectedFrame.integrity = { status: "crc-failed", expected: 41_330, actual: 12 };

    const bytes = await buildEvidenceBundle({ session, range, generatedAt: "2026-07-16T06:00:00.000Z" });
    const decodedCsv = decodeText(unzipSync(bytes), "decoded/packets.csv");

    expect(decodedCsv).toContain('""actual"":12');
    expect(decodedCsv).toContain('""expected"":41330');
    expect(decodedCsv).toContain('""status"":""crc-failed""');
  });

  it("neutralizes spreadsheet formulas in exported CSV string cells", async () => {
    const session = makeSession();
    const selectedFrame = session.frames[1];
    const selectedDiagnostic = session.diagnostics.find((event) => event.id === "transport-transport-overlaps-start");
    if (!selectedFrame || !selectedDiagnostic) throw new Error("Expected selected fixture rows");
    selectedFrame.familyName = "=2+3";
    selectedDiagnostic.title = "@SUM(A1:A2)";
    selectedDiagnostic.description = "-2+3";

    const bytes = await buildEvidenceBundle({
      session,
      range,
      generatedAt: "2026-07-16T06:00:00.000Z",
    });
    const archive = unzipSync(bytes);
    const decodedCsv = decodeText(archive, "decoded/packets.csv");
    const diagnosticsCsv = decodeText(archive, "diagnostics/diagnostics.csv");

    expect(decodedCsv).toContain(",'=2+3,");
    expect(decodedCsv).not.toContain(",=2+3,");
    expect(diagnosticsCsv).toContain(",'@SUM(A1:A2),'-2+3,");
    expect(diagnosticsCsv).not.toContain(",@SUM(A1:A2),-2+3,");
  });

  it("rejects empty, unsafe, or out-of-session ranges", async () => {
    const session = makeSession();
    await expect(buildEvidenceBundle({ session, range: { startUs: 2_000, endUs: 2_000 } })).rejects.toThrow(
      "non-empty half-open interval",
    );
    await expect(buildEvidenceBundle({ session, range: { startUs: 1_000, endUs: 3_001 } })).rejects.toThrow(
      "beyond the session duration",
    );
    await expect(
      buildEvidenceBundle({ session, range: { startUs: 1_000.5, endUs: 2_000 } }),
    ).rejects.toThrow("safe integer microseconds");
  });
});

describe("suggestEvidenceBundleFilename", () => {
  it("returns a filesystem-safe .nlb name", () => {
    expect(suggestEvidenceBundleFilename(makeSession(), range)).toBe("harbor-relay-07-link-fade.nlb");
  });
});
