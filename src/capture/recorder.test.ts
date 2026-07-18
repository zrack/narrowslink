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
import type { UdpBridgeJournal, UdpRemoteEndpoint } from "../domain/types";
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

const UDP_CAPTURE_STARTED_AT = "2026-07-15T18:00:00.000-07:00";

function remoteEndpoint(port = 55_555): UdpRemoteEndpoint {
  return { address: "192.0.2.44", port, family: "IPv4" };
}

function cleanUdpJournal(
  datagrams: number,
  bytes: number,
  durationUs: number,
): UdpBridgeJournal {
  const endedAt = "2026-07-15T18:00:01.000-07:00";
  return {
    captureId: "capture-test-bridge",
    startedAt: UDP_CAPTURE_STARTED_AT,
    endedAt,
    state: "clean",
    bind: {
      requestedHost: "127.0.0.1",
      requestedPort: 9_104,
      host: "127.0.0.1",
      port: 9_104,
      family: "IPv4",
    },
    multicast: null,
    datagrams,
    bytes,
    kernelDroppedDatagrams: null,
    kernelDroppedDatagramsSource: "unavailable",
    entriesComplete: true,
    omittedEntries: 0,
    entries: [
      {
        sequence: 0,
        type: "capture-started",
        at: UDP_CAPTURE_STARTED_AT,
        offsetUs: 0,
        datagrams: 0,
        bytes: 0,
      },
      {
        sequence: 1,
        type: "capture-stopped",
        at: endedAt,
        offsetUs: durationUs,
        datagrams,
        bytes,
      },
    ],
  };
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
    const capturedBytes = frame.length + 4;
    const document = recorder.finalize(1_000_000, {
      stopDisposition: "confirmed",
      stopOffsetUs: 1_000_000,
      eventLogComplete: true,
      observedUnits: 2,
      observedBytes: capturedBytes,
      transportReportedUnits: 2,
      transportReportedBytes: capturedBytes,
    });
    const parsed = parseSession(document);

    expect(document).toMatchObject({
      format: "narrowslink/session",
      formatVersion: 2,
      durationUs: 1_000_000,
      decoder: SUPPORTED_DECODER,
      transportEvents: [],
      captureIntegrity: {
        status: "verified",
        assessmentBasis: "udp-bridge-reconciled",
        stopDisposition: "confirmed",
        retained: { records: 2, bytes: capturedBytes },
        issueCodes: [],
      },
      incidents: [{
        id: "capture-interval",
        title: "Captured interval",
        startUs: 0,
        endUs: 1_000_000,
        severity: "info",
      }],
    });
    expect(document.records).toHaveLength(2);
    expect("transportProvenance" in document).toBe(false);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.records)).toBe(true);
    expect(Object.isFrozen(document.records[0])).toBe(true);
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");
    expect(Object.isFrozen(document.transportEvents)).toBe(true);
    expect(Object.isFrozen(document.captureIntegrity)).toBe(true);
    expect(Object.isFrozen(document.captureIntegrity.input)).toBe(true);
    expect(Object.isFrozen(document.captureIntegrity.retained)).toBe(true);
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

  it("builds verified immutable UDP provenance while treating unavailable kernel counters as a boundary", () => {
    const recorder = udpRecorder();
    const endpoint = remoteEndpoint();
    recorder.append({
      offsetUs: 0,
      bytes: new Uint8Array([1, 2]),
      kernelDropCounter: null,
      remoteEndpoint: endpoint,
    });
    recorder.append({ offsetUs: 10, bytes: new Uint8Array([3]), remoteEndpoint: endpoint });
    endpoint.address = "198.51.100.8";

    const document = recorder.finalize(20, {
      stopDisposition: "confirmed",
      stopOffsetUs: 20,
      eventLogComplete: true,
      observedUnits: 2,
      observedBytes: 3,
      transportProvenance: { transport: "udp", journal: cleanUdpJournal(2, 3, 20) },
    });
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");

    expect(document.captureIntegrity).toMatchObject({ status: "verified", issueCodes: [] });
    expect(document.transportProvenance).toMatchObject({
      transport: "udp",
      status: "verified",
      issueCodes: ["udp-kernel-drop-counter-unavailable"],
      endpointAttribution: {
        totalRecords: 2,
        attributedRecords: 2,
        unattributedRecords: 0,
        distinctEndpoints: [{ address: "192.0.2.44", port: 55_555, family: "IPv4" }],
      },
    });
    expect(document.records[0]?.transport).toMatchObject({
      kernelDropCounter: null,
      remoteEndpoint: { address: "192.0.2.44", port: 55_555, family: "IPv4" },
    });
    expect(Object.isFrozen(document.transportProvenance)).toBe(true);
    expect(Object.isFrozen(document.transportProvenance?.transport === "udp"
      ? document.transportProvenance.journal?.entries
      : null)).toBe(true);
  });

  it("marks explicitly unavailable UDP provenance incomplete without changing legacy callers", () => {
    const recorder = udpRecorder();
    recorder.append({ offsetUs: 0, bytes: new Uint8Array([1, 2]) });

    const document = recorder.finalize(5, {
      stopDisposition: "confirmed",
      stopOffsetUs: 5,
      eventLogComplete: true,
      observedUnits: 1,
      observedBytes: 2,
      transportReportedUnits: 1,
      transportReportedBytes: 2,
      transportProvenance: { transport: "udp", journal: null },
    });
    if (document.formatVersion !== 2 || document.transportProvenance?.transport !== "udp") {
      throw new Error("Expected UDP provenance");
    }

    expect(document.transportProvenance).toMatchObject({
      status: "incomplete",
      issueCodes: ["udp-bridge-journal-unavailable", "udp-endpoint-attribution-incomplete"],
      endpointAttribution: { attributedRecords: 0, unattributedRecords: 1 },
    });
    expect(document.captureIntegrity).toMatchObject({
      status: "incomplete",
      issueCodes: ["transport-provenance-incomplete"],
    });
    expect(parseSession(document).diagnostics).toContainEqual(expect.objectContaining({
      id: "transport-provenance-incomplete",
      domain: "capture-path",
    }));
  });

  it("preserves explicit serial settings and nullable device identifiers without downgrading integrity", () => {
    const recorder = new CaptureRecorder({
      sessionId: "serial-provenance",
      title: "Serial provenance",
      startedAt: "2026-07-16T01:00:00.000Z",
      displayTimeZone: "UTC",
      source: { id: "serial-live", kind: "serial", label: "Serial loopback" },
    });
    recorder.append({ offsetUs: 0, bytes: new Uint8Array([1, 2]) });

    const document = recorder.finalize(5, {
      stopDisposition: "confirmed",
      stopOffsetUs: 5,
      eventLogComplete: true,
      observedUnits: 1,
      observedBytes: 2,
      transportReportedUnits: null,
      transportReportedBytes: null,
      transportProvenance: {
        transport: "serial",
        device: { usbVendorId: null, usbProductId: null, bluetoothServiceClassId: null },
        settings: {
          baudRate: 115_200,
          dataBits: 8,
          stopBits: 1,
          parity: "none",
          bufferSize: 65_536,
          flowControl: "none",
        },
      },
    });
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");

    expect(document.captureIntegrity).toMatchObject({ status: "verified", issueCodes: [] });
    expect(document.transportProvenance).toEqual({
      schemaVersion: 1,
      transport: "serial",
      sourceId: "serial-live",
      status: "verified",
      issueCodes: ["serial-device-identifiers-unavailable"],
      device: { usbVendorId: null, usbProductId: null, bluetoothServiceClassId: null },
      settings: {
        baudRate: 115_200,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        bufferSize: 65_536,
        flowControl: "none",
      },
    });
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

  it("reserves bounded provenance before accepting records and accounts distinct endpoint summaries", () => {
    expect(() => udpRecorder({ maxSessionFileBytes: 1_000_000 })).toThrow(
      "metadata leaves no room for records",
    );

    const recorder = udpRecorder();
    const reservedEnvelope = recorder.projectedSessionFileBytes;
    expect(reservedEnvelope).toBeGreaterThan(1 * 1024 * 1024);
    recorder.append({ offsetUs: 0, bytes: new Uint8Array([1]), remoteEndpoint: remoteEndpoint() });
    const oneEndpoint = recorder.projectedSessionFileBytes;
    recorder.append({ offsetUs: 1, bytes: new Uint8Array([2]), remoteEndpoint: remoteEndpoint() });
    const repeatedEndpointDelta = recorder.projectedSessionFileBytes - oneEndpoint;
    recorder.append({ offsetUs: 2, bytes: new Uint8Array([3]), remoteEndpoint: remoteEndpoint(55_556) });
    const distinctEndpointDelta = recorder.projectedSessionFileBytes - oneEndpoint - repeatedEndpointDelta;
    expect(distinctEndpointDelta).toBeGreaterThan(repeatedEndpointDelta);
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

  it("never certifies recorder-only finalization without adapter stop evidence", () => {
    const recorder = udpRecorder();
    recorder.append({ offsetUs: 0, bytes: new Uint8Array([1, 2]) });

    const document = recorder.finalize(5);
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");

    expect(document.captureIntegrity).toEqual({
      schemaVersion: 1,
      status: "incomplete",
      assessmentBasis: "recorder-only",
      stopDisposition: "unconfirmed",
      stopOffsetUs: 5,
      eventLogComplete: false,
      input: {
        unit: "datagram",
        observedUnits: null,
        observedBytes: null,
        transportReportedUnits: null,
        transportReportedBytes: null,
      },
      retained: { records: 1, bytes: 2 },
      issueCodes: ["shutdown-unconfirmed", "event-log-incomplete"],
    });
    expect(document.transportEvents).toEqual([expect.objectContaining({
      type: "shutdown-unconfirmed",
      transport: "udp",
      scope: { kind: "session" },
      code: "recorder-finalization-unassessed",
    })]);
  });

  it("persists immutable transport events and derives an incomplete receipt", () => {
    const recorder = udpRecorder();
    recorder.append({ offsetUs: 0, bytes: new Uint8Array([1, 2]) });
    recorder.appendTransportEvent({
      type: "udp-event-sequence-discontinuity",
      transport: "udp",
      scope: { kind: "point", offsetUs: 0 },
      severity: "critical",
      message: "SSE sequence 4 arrived where 3 was expected.",
      expectedSequence: 3,
      observedSequence: 4,
    });

    const document = recorder.finalize(1, {
      eventLogComplete: true,
      observedUnits: 1,
      observedBytes: 2,
      transportReportedUnits: 1,
      transportReportedBytes: 2,
      stopDisposition: "confirmed",
      stopOffsetUs: 1,
    });
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");

    expect(document.transportEvents).toEqual([expect.objectContaining({
      id: "capture-transport-event-000001",
      index: 0,
      type: "udp-event-sequence-discontinuity",
      expectedSequence: 3,
      observedSequence: 4,
    })]);
    expect(document.captureIntegrity).toMatchObject({
      status: "incomplete",
      eventLogComplete: true,
      issueCodes: ["udp-event-sequence-discontinuity"],
    });
    expect(Object.isFrozen(document.transportEvents[0])).toBe(true);
    expect(Object.isFrozen(document.transportEvents[0]?.scope)).toBe(true);
  });

  it("creates exact UDP counter and shutdown evidence from final observations", () => {
    const recorder = udpRecorder();
    recorder.append({ offsetUs: 0, bytes: new Uint8Array([1, 2]) });

    const document = recorder.finalize(5, {
      eventLogComplete: true,
      observedUnits: 1,
      observedBytes: 2,
      transportReportedUnits: 2,
      transportReportedBytes: 5,
      stopDisposition: "unconfirmed",
      stopOffsetUs: 5,
      shutdown: { code: "bridge-unreachable", message: "The bridge did not answer the stop request." },
    });
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");

    expect(document.transportEvents.map((event) => event.type)).toEqual([
      "shutdown-unconfirmed",
      "udp-counter-mismatch",
    ]);
    expect(document.transportEvents[1]).toMatchObject({
      bridgeDatagrams: 2,
      bridgeBytes: 5,
      browserDatagrams: 1,
      browserBytes: 2,
      retainedRecords: 1,
      retainedBytes: 2,
    });
    expect(document.captureIntegrity).toMatchObject({
      status: "incomplete",
      stopDisposition: "unconfirmed",
      input: {
        observedUnits: 1,
        observedBytes: 2,
        transportReportedUnits: 2,
        transportReportedBytes: 5,
      },
      issueCodes: ["udp-counter-mismatch", "shutdown-unconfirmed"],
    });
  });

  it("records a dedicated serial counter mismatch without mislabeling the event log", () => {
    const recorder = new CaptureRecorder({
      sessionId: "serial-counter-mismatch",
      title: "Serial counter mismatch",
      startedAt: "2026-07-16T01:00:00.000Z",
      displayTimeZone: "UTC",
      source: { id: "serial-live", kind: "serial", label: "Serial loopback" },
    });
    recorder.append({ offsetUs: 0, bytes: new Uint8Array([1]) });

    const document = recorder.finalize(5, {
      stopDisposition: "confirmed",
      stopOffsetUs: 5,
      eventLogComplete: true,
      observedUnits: 1,
      observedBytes: 2,
      transportReportedUnits: null,
      transportReportedBytes: null,
    });
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");

    expect(document.transportEvents).toEqual([expect.objectContaining({
      type: "serial-counter-mismatch",
      observedReads: 1,
      observedBytes: 2,
      retainedRecords: 1,
      retainedBytes: 1,
    })]);
    expect(document.captureIntegrity).toMatchObject({
      status: "incomplete",
      assessmentBasis: "web-serial-observed",
      eventLogComplete: true,
      issueCodes: ["serial-counter-mismatch"],
    });
  });

  it("budgets serialized transport evidence and preserves it across a finalization retry", () => {
    const recorder = udpRecorder({ maxSessionFileBytes: 1_100_000 });
    recorder.append({ offsetUs: 10, bytes: new Uint8Array([1]) });
    const beforeEvent = recorder.projectedSessionFileBytes;
    recorder.appendTransportEvent({
      type: "udp-bridge-error",
      transport: "udp",
      scope: { kind: "point", offsetUs: 10 },
      severity: "warning",
      message: "Transient local bridge warning.",
      code: "bridge-warning",
      fatal: false,
    });
    expect(recorder.projectedSessionFileBytes).toBeGreaterThan(beforeEvent);

    expect(() => recorder.finalize(9)).toThrow("precedes the last record");
    const document = recorder.finalize(11, {
      stopDisposition: "confirmed",
      stopOffsetUs: 11,
      eventLogComplete: true,
      observedUnits: 1,
      observedBytes: 1,
      transportReportedUnits: 1,
      transportReportedBytes: 1,
    });
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");
    expect(document.transportEvents).toEqual([expect.objectContaining({
      id: "capture-transport-event-000001",
      index: 0,
      code: "bridge-warning",
    })]);
    expect(encodeSessionDocument(document).byteLength).toBeLessThanOrEqual(1_100_000);
  });

  it("pairs a not-observed stop disposition with a null stop offset", () => {
    const recorder = udpRecorder();
    recorder.append({ offsetUs: 0, bytes: new Uint8Array([1]) });
    const document = recorder.finalize(1, {
      stopDisposition: "not-observed",
      eventLogComplete: false,
      observedUnits: 1,
      observedBytes: 1,
      transportReportedUnits: 1,
      transportReportedBytes: 1,
    });
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");
    expect(document.captureIntegrity).toMatchObject({
      status: "incomplete",
      stopDisposition: "not-observed",
      stopOffsetUs: null,
      eventLogComplete: false,
      issueCodes: ["event-log-incomplete"],
    });
  });
});
