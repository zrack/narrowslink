import { describe, expect, it } from "vitest";

import { encodeFrame, SUPPORTED_DECODER } from "../domain/decoder";
import { parseSession, SessionValidationError, validateSessionDocument } from "../domain/session";
import { loadSessionFile } from "../data/load-session";
import {
  encodeSessionDocument,
  MAX_SESSION_FILE_BYTES,
  serializeSessionDocument,
  utf8ByteLength,
} from "../data/session-file";
import {
  CaptureRecorder,
  CaptureRecorderError,
  MAX_CAPTURE_BYTES,
  MAX_CAPTURE_RECORD_BYTES,
  MAX_CAPTURE_RECORDS,
} from "./recorder";

function udpRecorder(limits?: ConstructorParameters<typeof CaptureRecorder>[0]["limits"]): CaptureRecorder {
  return new CaptureRecorder({
    sessionId: "capture-test",
    title: "Live harbor capture",
    startedAt: "2026-07-15T18:00:00.000-07:00",
    displayTimeZone: "America/Los_Angeles",
    source: {
      id: "udp-live",
      kind: "udp",
      label: "UDP 127.0.0.1:9104",
      address: "127.0.0.1",
      port: 9104,
    },
    limits,
  });
}

describe("CaptureRecorder", () => {
  it("finalizes a live capture into the existing replay and investigation pipeline", () => {
    const recorder = udpRecorder();
    const frame = encodeFrame({
      familyId: 0x02,
      sequence: 7,
      deviceTimeMs: 0,
      payload: new Uint8Array(8),
    });

    recorder.append({
      offsetUs: 0,
      bytes: frame,
      wireBytes: frame.length + 28,
      kernelDropCounter: 2,
      signal: { rssiDbm: -71, snrDb: 18, provenance: "gateway-sidecar" },
    });
    recorder.append({ offsetUs: 250_000, bytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) });
    const document = recorder.finalize(1_000_000);
    const parsed = parseSession(document);

    expect(document).toMatchObject({
      format: "narrowslink/session",
      formatVersion: 1,
      durationUs: 1_000_000,
      decoder: SUPPORTED_DECODER,
      incidents: [{
        id: "capture-interval",
        title: "Captured interval",
        startUs: 0,
        endUs: 1_000_000,
        severity: "info",
      }],
    });
    expect(document.records).toHaveLength(2);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.records)).toBe(true);
    expect(Object.isFrozen(document.records[0])).toBe(true);
    expect(document.records[0]).toMatchObject({
      id: "capture-record-000001",
      index: 0,
      captureBytes: frame.length,
      wireBytes: frame.length + 28,
      transport: { kind: "udp", kernelDropCounter: 2 },
      signal: { rssiDbm: -71, snrDb: 18 },
    });
    expect(parsed.frames.map((decoded) => decoded.status)).toEqual(["complete", "partial"]);
    expect(parsed.diagnostics.some((event) => event.type === "partial-frame")).toBe(true);
  });

  it("copies bytes when they are appended so later transport-buffer reuse cannot mutate evidence", () => {
    const recorder = udpRecorder();
    const bytes = new Uint8Array([0x01, 0x02, 0x03]);

    const record = recorder.append({ offsetUs: 0, bytes });
    bytes.fill(0xff);

    expect(record?.dataHex).toBe("010203");
  });

  it("fails clearly instead of creating an invalid zero-record session", () => {
    expect(() => udpRecorder().finalize(1)).toThrow(
      "Cannot finalize an empty capture; record at least one UDP datagram or serial segment.",
    );
  });

  it("rejects invalid session metadata before capture begins", () => {
    expect(() => new CaptureRecorder({
      sessionId: "capture-test",
      title: "Invalid zone",
      startedAt: "2026-07-16T01:00:00.000Z",
      displayTimeZone: "Mars/Olympus_Mons",
      source: { id: "udp-live", kind: "udp", label: "UDP :9104", port: 9104 },
    })).toThrow("Capture configuration is invalid");
  });

  it("enforces monotonic offsets and safe wire metadata at append time", () => {
    const recorder = udpRecorder();
    recorder.append({ offsetUs: 5, bytes: new Uint8Array([1, 2]) });

    expect(() => recorder.append({ offsetUs: 4, bytes: new Uint8Array([3]) })).toThrow("must be monotonic");
    expect(() => recorder.append({ offsetUs: 6, bytes: new Uint8Array([3, 4]), wireBytes: 1 })).toThrow(
      "Wire byte count",
    );
  });

  it("enforces record, total-byte, per-record, and duration limits with actionable errors", () => {
    expect(MAX_CAPTURE_RECORDS).toBe(100_000);
    expect(MAX_CAPTURE_BYTES).toBe(32 * 1024 * 1024);

    const recordLimited = udpRecorder({ maxRecords: 1 });
    recordLimited.append({ offsetUs: 0, bytes: new Uint8Array([1]) });
    expect(() => recordLimited.append({ offsetUs: 1, bytes: new Uint8Array([2]) })).toThrow(
      "1-record limit",
    );

    const byteLimited = udpRecorder({ maxCapturedBytes: 3 });
    byteLimited.append({ offsetUs: 0, bytes: new Uint8Array([1, 2]) });
    expect(() => byteLimited.append({ offsetUs: 1, bytes: new Uint8Array([3, 4]) })).toThrow(
      "3-byte limit",
    );

    const durationLimited = udpRecorder({ maxDurationUs: 10 });
    expect(() => durationLimited.append({ offsetUs: 10, bytes: new Uint8Array([1]) })).toThrow(
      "duration limit",
    );

    expect(() => udpRecorder().append({
      offsetUs: 0,
      bytes: new Uint8Array(MAX_CAPTURE_RECORD_BYTES + 1),
    })).toThrow(`cannot exceed ${MAX_CAPTURE_RECORD_BYTES} bytes`);
  });

  it("retains zero-length UDP datagrams as diagnosable records without pausing later input", () => {
    const recorder = udpRecorder();

    const empty = recorder.append({ offsetUs: 1, bytes: new Uint8Array(), wireBytes: 0 });
    recorder.append({ offsetUs: 2, bytes: new Uint8Array([0xa5]) });
    const document = recorder.finalize(3);
    const parsed = parseSession(document);

    expect(empty).toMatchObject({ dataHex: "", captureBytes: 0, wireBytes: 0 });
    expect(recorder.recordCount).toBe(2);
    expect(recorder.capturedBytes).toBe(1);
    expect(parsed.frames[0]).toMatchObject({ status: "partial", integrity: { status: "truncated" } });
    expect(parsed.diagnostics.filter((event) => event.type === "partial-frame")).toHaveLength(2);

    for (const kind of ["serial", "file"] as const) {
      const invalid = JSON.parse(JSON.stringify(document)) as typeof document;
      invalid.source.kind = kind;
      invalid.records[0]!.transport.kind = kind;
      invalid.records[1]!.transport.kind = kind;
      try {
        validateSessionDocument(invalid);
        throw new Error(`Expected ${kind} zero-length record to be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(SessionValidationError);
        expect((error as SessionValidationError).details.join("\n")).toContain("zero-length datagram");
      }
    }
  });

  it("fills the conservative 32 MiB file budget and remains re-importable at the accepted boundary", async () => {
    const recorder = udpRecorder();
    const maximumRecord = new Uint8Array(MAX_CAPTURE_RECORD_BYTES).fill(0x11);
    let offsetUs = 0;

    while (true) {
      try {
        recorder.append({ offsetUs, bytes: maximumRecord });
        offsetUs += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(CaptureRecorderError);
        expect((error as Error).message).toContain("replay-file limit");
        break;
      }
    }

    const remainingBudget = MAX_SESSION_FILE_BYTES - recorder.projectedSessionFileBytes;
    const nextIndex = recorder.recordCount;
    const nextId = `capture-record-${String(nextIndex + 1).padStart(6, "0")}`;
    const additionalBytes = (length: number): number => utf8ByteLength(JSON.stringify({
      id: nextId,
      index: nextIndex,
      sourceId: "udp-live",
      offsetUs,
      dataHex: "11".repeat(length),
      captureBytes: length,
      wireBytes: length,
      transport: { kind: "udp" },
    })) + 1;
    let low = 0;
    let high = Math.min(MAX_CAPTURE_RECORD_BYTES, Math.floor(remainingBudget / 2));
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (additionalBytes(middle) <= remainingBudget) low = middle;
      else high = middle - 1;
    }
    if (low > 0) {
      recorder.append({ offsetUs, bytes: new Uint8Array(low).fill(0x11) });
      offsetUs += 1;
    }
    expect(() => recorder.append({ offsetUs, bytes: new Uint8Array([0x11]) })).toThrow("replay-file limit");

    const document = recorder.finalize(offsetUs + 1);
    const bytes = encodeSessionDocument(document);
    expect(bytes.byteLength).toBeLessThanOrEqual(MAX_SESSION_FILE_BYTES);
    expect(utf8ByteLength(serializeSessionDocument(document))).toBe(bytes.byteLength);

    const file = {
      name: "maximum-capture.nlsession",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as File;
    const imported = await loadSessionFile(file);
    expect(imported.document.records).toHaveLength(recorder.recordCount);
  }, 30_000);

  it("does not accept writes or a second finalization after capture stops", () => {
    const recorder = udpRecorder();
    recorder.append({ offsetUs: 0, bytes: new Uint8Array([1]) });
    recorder.finalize(1);

    expect(() => recorder.append({ offsetUs: 1, bytes: new Uint8Array([2]) })).toThrow(CaptureRecorderError);
    expect(() => recorder.finalize(2)).toThrow("already been finalized");
  });
});
