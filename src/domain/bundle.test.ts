import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  buildEvidenceBundle,
  suggestEvidenceBundleFilename,
  type EvidenceBundleManifest,
  type EvidenceNote,
  type EvidenceRange,
} from "./bundle";
import type {
  DecodedFrame,
  DiagnosticEvent,
  Marker,
  ParsedSession,
  SessionDocument,
  SourceRecord,
} from "./types";

function sourceRecord(id: string, index: number, offsetUs: number): SourceRecord {
  return {
    id,
    index,
    sourceId: "gateway-1",
    offsetUs,
    dataHex: "A55A010200000000000000000000",
    captureBytes: 14,
    wireBytes: 14,
    transport: { kind: "udp", kernelDropCounter: 0 },
    signal: { rssiDbm: -72, snrDb: 11, provenance: "gateway-sidecar" },
  };
}

function frame(record: SourceRecord): DecodedFrame {
  return {
    id: `frame-${record.id}`,
    ordinal: record.index,
    offsetUs: record.offsetUs,
    sourceRecord: record,
    protocolVersion: 1,
    familyId: 0x02,
    familyName: "Heartbeat",
    sequence: record.index,
    deviceTimeMs: Math.floor(record.offsetUs / 1000),
    payloadLength: 0,
    integrity: { status: "valid", checksum: 0 },
    status: "complete",
    fields: [{ name: "mode", raw: 2, value: "Nominal", quality: "valid" }],
  };
}

function diagnostic(id: string, startUs: number, endUs?: number): DiagnosticEvent {
  return {
    id,
    type: "crc-failure",
    severity: "critical",
    startUs,
    ...(endUs == null ? {} : { endUs }),
    title: `Diagnostic ${id}`,
    description: `Description, with comma for ${id}`,
    frameIds: [],
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

function makeSession(): ParsedSession {
  const records = [
    sourceRecord("record-before", 0, 999),
    sourceRecord("record-start", 1, 1_000),
    sourceRecord("record-inside", 2, 1_999),
    sourceRecord("record-end", 3, 2_000),
  ];
  const document: SessionDocument = {
    format: "narrowslink/session",
    formatVersion: 1,
    id: "Harbor Relay / 07",
    title: "Harbor Relay Session 07",
    startedAt: "2026-07-16T04:38:12.000Z",
    displayTimeZone: "America/Los_Angeles",
    durationUs: 3_000,
    source: { id: "gateway-1", kind: "udp", label: "Gateway 1", address: "127.0.0.1", port: 9120 },
    decoder: { id: "NSL-01", revision: "2026.7", schemaHash: "b79f6edc8a123456b79f6edc8a123456b79f6edc8a123456b79f6edc8a123456" },
    records,
    incidents: [],
  };
  const frames = records.map(frame);
  return {
    document,
    frames,
    buckets: [],
    diagnostics: [
      diagnostic("diag-ends-at-start", 500, 1_000),
      diagnostic("diag-overlaps-start", 500, 1_001),
      diagnostic("diag-before", 999),
      diagnostic("diag-start", 1_000),
      diagnostic("diag-inside", 1_999),
      diagnostic("diag-end", 2_000),
    ],
    incidents: [],
    framesById: new Map(frames.map((item) => [item.id, item])),
  };
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
    expect(diagnosticDocument.diagnostics.map((item) => item.id)).toEqual(["diag-overlaps-start", "diag-start", "diag-inside"]);

    const markerDocument = JSON.parse(decodeText(archive, "markers/markers.json")) as { markers: Marker[] };
    expect(markerDocument.markers.map((item) => item.id)).toEqual(["marker-start", "marker-inside"]);

    const noteDocument = JSON.parse(decodeText(archive, "notes/notes.json")) as { notes: EvidenceNote[] };
    expect(noteDocument.notes.map((item) => item.id)).toEqual(["general", "start", "inside"]);

    const manifest = JSON.parse(decodeText(archive, "manifest.json")) as EvidenceBundleManifest;
    expect(manifest.format).toBe("narrowslink/evidence-bundle");
    expect(manifest.selection).toMatchObject({
      id: "link-fade",
      startUs: 1_000,
      endUs: 2_000,
      rangeSemantics: "half-open [startUs, endUs)",
    });
    expect(manifest.artifacts.find((item) => item.path === "raw/source-records.ndjson")?.recordCount).toBe(2);
    expect(manifest.artifacts.find((item) => item.path === "markers/markers.json")?.recordCount).toBe(2);

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
      },
      generatedAt: "2026-07-16T06:00:00.000Z",
    });
    const archive = unzipSync(bytes);
    expect(Object.keys(archive).sort()).toEqual(["SHA256SUMS", "manifest.json"]);
    const manifest = JSON.parse(decodeText(archive, "manifest.json")) as EvidenceBundleManifest;
    expect(manifest.artifacts).toEqual([]);
    expect(manifest.checksums.covers).toEqual(["manifest.json"]);
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
    const session = makeSession();
    const startRecord = session.document.records[1];
    const insideRecord = session.document.records[2];
    const insideFrame = session.frames[2];
    if (!startRecord || !insideRecord || !insideFrame) throw new Error("Expected range fixtures");
    insideRecord.offsetUs = startRecord.offsetUs;
    insideFrame.offsetUs = startRecord.offsetUs;

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
    const selectedDiagnostic = session.diagnostics[1];
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
