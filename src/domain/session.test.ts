import { describe, expect, it } from "vitest";
import { bytesToHex, encodeFrame, SUPPORTED_DECODER } from "./decoder";
import { parseSession, rowsInRange, SessionValidationError, validateSessionDocument } from "./session";
import { MAX_SESSION_DURATION_US, type FamilyId, type SessionDocument, type SourceRecord } from "./types";

function payloadFor(familyId: FamilyId): Uint8Array {
  const sizes: Record<FamilyId, number> = { 0x02: 8, 0x17: 9, 0x19: 16, 0x31: 24, 0x44: 10 };
  const payload = new Uint8Array(sizes[familyId]);
  if (familyId === 0x31) {
    const view = new DataView(payload.buffer);
    view.setInt32(0, 472_672_000, true);
    view.setInt32(4, -1_225_514_000, true);
    view.setInt32(8, 184_000, true);
    view.setUint8(22, 3);
    view.setUint8(23, 10);
  }
  return payload;
}

function record(index: number, offsetUs: number, sequence: number, familyId: FamilyId, corruptChecksum = false): SourceRecord {
  const bytes = encodeFrame({
    familyId,
    sequence,
    deviceTimeMs: Math.floor(offsetUs / 1000),
    payload: payloadFor(familyId),
    corruptChecksum,
  });
  return {
    id: `record-${index}`,
    index,
    sourceId: "harbor-udp",
    offsetUs,
    dataHex: bytesToHex(bytes),
    captureBytes: bytes.length,
    wireBytes: bytes.length,
    transport: { kind: "udp" },
    signal: { rssiDbm: offsetUs < 2_000_000 ? -68 : -96, provenance: "gateway-sidecar" },
  };
}

function document(): SessionDocument {
  return {
    format: "narrowslink/session",
    formatVersion: 1,
    id: "session-test",
    title: "Harbor relay downlink",
    startedAt: "2026-07-16T04:38:12.000Z",
    displayTimeZone: "America/Los_Angeles",
    durationUs: 6_000_000,
    source: { id: "harbor-udp", kind: "udp", label: "UDP :9104", address: "127.0.0.1", port: 9104 },
    decoder: { ...SUPPORTED_DECODER },
    records: [
      record(0, 0, 10, 0x31),
      record(1, 1_000_000, 11, 0x17),
      record(2, 2_000_000, 14, 0x44, true),
      record(3, 3_000_000, 15, 0x19),
      record(4, 4_000_000, 16, 0x02),
    ],
    incidents: [{ id: "fade", title: "Fade", startUs: 1_000_000, endUs: 5_000_000, severity: "critical" }],
  };
}

describe("session parsing", () => {
  it("validates, decodes, derives metrics, and projects incidents", () => {
    const parsed = parseSession(document());

    expect(parsed.frames).toHaveLength(5);
    expect(parsed.buckets).toHaveLength(6);
    expect(parsed.buckets[0]).toMatchObject({ latitude: 47.2672, longitude: -122.5514, altitudeM: 184 });
    expect(parsed.buckets[1]).toMatchObject({ latitude: 47.2672, longitude: -122.5514, altitudeM: 184 });
    expect(parsed.buckets[3]?.missing).toBe(2);
    expect(parsed.incidents[0]?.stats.missingFrames).toBe(2);
    expect(parsed.incidents[0]?.stats.completePackets).toBe(3);
    expect(parsed.diagnostics.some((event) => event.type === "crc-failure")).toBe(true);
  });

  it("uses half-open ranges", () => {
    const rows = [{ offsetUs: 0 }, { offsetUs: 10 }, { offsetUs: 20 }, { offsetUs: 30 }];
    expect(rowsInRange(rows, 10, 30)).toEqual([{ offsetUs: 10 }, { offsetUs: 20 }]);
  });

  it("rejects non-monotonic timestamps with an actionable error", () => {
    const invalid = document();
    invalid.records = [record(0, 2_000_000, 1, 0x02), record(1, 1_000_000, 2, 0x02)];

    expect(() => validateSessionDocument(invalid)).toThrow(SessionValidationError);
    try {
      validateSessionDocument(invalid);
    } catch (error) {
      expect((error as SessionValidationError).message).toContain("not monotonic");
    }
  });

  it("rejects inconsistent record provenance before decoding", () => {
    const badIndex = document();
    const indexedRecord = badIndex.records[1];
    if (!indexedRecord) throw new Error("Expected fixture record");
    indexedRecord.index = 9;
    expect(() => validateSessionDocument(badIndex)).toThrow("indices must be contiguous");

    const badWireLength = document();
    const wireRecord = badWireLength.records[0];
    if (!wireRecord) throw new Error("Expected fixture record");
    wireRecord.wireBytes = wireRecord.captureBytes - 1;
    expect(() => validateSessionDocument(badWireLength)).toThrow("fewer wire bytes");

    const badTransport = document();
    const transportRecord = badTransport.records[0];
    if (!transportRecord) throw new Error("Expected fixture record");
    transportRecord.transport.kind = "serial";
    expect(() => validateSessionDocument(badTransport)).toThrow("transport does not match");
  });

  it("rejects replay metadata that names an unsupported decoder descriptor", () => {
    const unsupported = document();
    unsupported.decoder = { ...SUPPORTED_DECODER, revision: "v1.3.6" };

    expect(() => validateSessionDocument(unsupported)).toThrow("unsupported decoder schema");
    try {
      validateSessionDocument(unsupported);
    } catch (error) {
      expect(error).toBeInstanceOf(SessionValidationError);
      expect((error as SessionValidationError).details).toEqual([
        expect.stringContaining("Received NSL-01 v1.3.6"),
        expect.stringContaining(`Supported ${SUPPORTED_DECODER.id} ${SUPPORTED_DECODER.revision}`),
      ]);
    }
  });

  it("projects the entire replay as a review range when no incidents are declared", () => {
    const replay = document();
    replay.incidents = [];

    const parsed = parseSession(replay);

    expect(parsed.incidents).toHaveLength(1);
    expect(parsed.incidents[0]).toMatchObject({
      id: "full-session",
      title: "Full session review",
      startUs: 0,
      endUs: replay.durationUs,
      severity: "info",
    });
    expect(parsed.incidents[0]?.stats.receivedFrames).toBe(replay.records.length);
  });

  it("reports unavailable link availability when the selected range has no signal samples", () => {
    const replay = document();
    for (const sourceRecord of replay.records) delete sourceRecord.signal;

    const parsed = parseSession(replay);

    expect(parsed.incidents[0]?.stats.linkAvailabilityPct).toBeNull();
    expect(parsed.buckets.every((bucket) => bucket.rssiDbm == null)).toBe(true);
  });

  it("uses sequence gaps when the kernel drop counter remains constant", () => {
    const replay = document();
    replay.records = [record(0, 0, 10, 0x02), record(1, 1_000_000, 13, 0x02)];
    for (const sourceRecord of replay.records) sourceRecord.transport.kernelDropCounter = 7;
    replay.incidents = [{ id: "loss", title: "Loss", startUs: 0, endUs: 2_000_000, severity: "warning" }];

    const parsed = parseSession(replay);

    expect(parsed.buckets[1]?.missing).toBe(2);
    expect(parsed.incidents[0]?.stats.missingFrames).toBe(2);
    expect(parsed.incidents[0]?.stats.expectedFrames).toBe(4);
  });

  it("does not double-count a loss reported by both sequence and transport counters", () => {
    const replay = document();
    replay.records = [record(0, 0, 10, 0x02), record(1, 1_000_000, 13, 0x02)];
    const firstRecord = replay.records[0];
    const secondRecord = replay.records[1];
    if (!firstRecord || !secondRecord) throw new Error("Expected loss fixture records");
    firstRecord.transport.kernelDropCounter = 4;
    secondRecord.transport.kernelDropCounter = 6;
    replay.incidents = [{ id: "loss", title: "Loss", startUs: 0, endUs: 2_000_000, severity: "warning" }];

    const parsed = parseSession(replay);

    expect(parsed.buckets[1]?.missing).toBe(2);
    expect(parsed.buckets.reduce((total, bucket) => total + bucket.missing, 0)).toBe(2);
    expect(parsed.incidents[0]?.stats.missingFrames).toBe(2);
  });

  it("attributes a sequence gap at the selected range boundary consistently", () => {
    const replay = document();
    replay.records = [record(0, 900_000, 10, 0x02), record(1, 1_100_000, 12, 0x02)];
    replay.incidents = [{ id: "boundary-loss", title: "Boundary loss", startUs: 1_000_000, endUs: 2_000_000, severity: "warning" }];

    const parsed = parseSession(replay);

    expect(parsed.buckets[1]?.missing).toBe(1);
    expect(parsed.incidents[0]?.stats.missingFrames).toBe(1);
  });

  it("retains a uniquely identified diagnostic for every malformed frame", () => {
    const replay = document();
    replay.records = Array.from({ length: 14 }, (_, index) => record(index, 2_000_000, 100 + index, 0x02, true));
    replay.incidents = [{ id: "malformed", title: "Malformed frames", startUs: 1_000_000, endUs: 3_000_000, severity: "critical" }];

    const parsed = parseSession(replay);
    const failures = parsed.diagnostics.filter((event) => event.type === "crc-failure");

    expect(failures).toHaveLength(14);
    expect(new Set(failures.map((event) => event.id)).size).toBe(14);
    expect(parsed.incidents[0]?.diagnostics.filter((event) => event.type === "crc-failure")).toHaveLength(14);
  });

  it("rejects unpaired UTF-16 surrogates before evidence encoding", () => {
    const replay = document();
    replay.records[0]!.id = "record-\ud800";

    expect(() => validateSessionDocument(replay)).toThrow(SessionValidationError);
    try {
      validateSessionDocument(replay);
    } catch (error) {
      expect((error as SessionValidationError).details.join("\n")).toContain("unpaired UTF-16 surrogate");
    }
  });

  it("rejects unknown document keys instead of silently stripping them", () => {
    const replay = document() as SessionDocument & { unexpectedMetadata?: string };
    replay.unexpectedMetadata = "must not survive validation";

    expect(() => validateSessionDocument(replay)).toThrow(SessionValidationError);
    try {
      validateSessionDocument(replay);
    } catch (error) {
      expect((error as SessionValidationError).details.join("\n")).toContain("unexpectedMetadata");
    }
  });

  it("bounds session duration to protect browser metric allocation", () => {
    const tooLong = document();
    tooLong.durationUs = MAX_SESSION_DURATION_US + 1;
    expect(() => validateSessionDocument(tooLong)).toThrow(SessionValidationError);
  });
});
