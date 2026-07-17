import { describe, expect, it, vi } from "vitest";

import {
  assertUdpCaptureIntegrity,
  boundFinalizationDuration,
  canRetainCapturedInput,
  captureFinalizationEvidence,
  ensureDurationLimitTransportEvent,
  flushOwnedBufferedUdpDatagrams,
  monotonicCaptureDurationUs,
  retainSerialAssemblerTail,
  serialTransportFailureEvent,
  stopUdpCaptureIfOwned,
  udpSequenceDiscontinuityEvent,
  UdpCaptureIntegrityError,
  UdpCaptureOwnershipError,
  verifiedCaptureDurationUs,
} from "./CaptureDialog";
import { Nsl01SerialFrameAssembler } from "./nsl01-serial-assembler";
import { CaptureRecorder, CaptureRecorderError } from "./recorder";
import type { UdpBridgeDatagram, UdpBridgeStatus } from "./udp-bridge";

function bridgeStatus(
  captureId: string,
  overrides: Partial<NonNullable<UdpBridgeStatus["capture"]>> = {},
  state: UdpBridgeStatus["state"] = "capturing",
): UdpBridgeStatus {
  return {
    protocolVersion: 1,
    state,
    control: { host: "127.0.0.1", port: 47_891 },
    defaults: {
      host: "127.0.0.1",
      port: 9_104,
      multicastGroup: null,
      multicastInterface: null,
    },
    udp: { host: "127.0.0.1", port: 9_104, family: "IPv4" },
    multicast: null,
    capture: {
      id: captureId,
      startedAt: "2026-07-16T00:00:00.000Z",
      datagrams: 0,
      bytes: 0,
      durationUs: 0,
      ...overrides,
    },
    subscribers: 1,
    lastError: null,
  };
}

function bridgeDatagram(
  sequence: number,
  values: readonly number[],
  captureId = "owned",
): UdpBridgeDatagram {
  const data = Uint8Array.from(values);
  return {
    protocolVersion: 1,
    captureId,
    sequence,
    offsetUs: sequence + 1,
    receivedAt: "2026-07-16T00:00:00.000Z",
    remoteAddress: "127.0.0.1",
    remotePort: 9_104,
    remoteFamily: "IPv4",
    byteLength: data.byteLength,
    dataBase64: "",
    data,
  };
}

describe("CaptureDialog UDP ownership", () => {
  it("never sends stop when fresh bridge status identifies a foreign capture", async () => {
    const stop = vi.fn(async () => bridgeStatus("foreign", {}, "stopped"));
    await expect(stopUdpCaptureIfOwned({
      getStatus: async () => bridgeStatus("foreign"),
      stop,
    }, "owned")).rejects.toBeInstanceOf(UdpCaptureOwnershipError);
    expect(stop).not.toHaveBeenCalled();
  });

  it("stops only after fresh status confirms the owned capture ID", async () => {
    const stopped = bridgeStatus("owned", { datagrams: 2, bytes: 4 }, "stopped");
    const stop = vi.fn(async () => stopped);
    await expect(stopUdpCaptureIfOwned({
      getStatus: async () => bridgeStatus("owned", { datagrams: 2, bytes: 4 }),
      stop,
    }, "owned")).resolves.toBe(stopped);
    expect(stop).toHaveBeenCalledOnce();
  });
});

describe("CaptureDialog UDP integrity", () => {
  it("accepts exact bridge, SSE, and recorder parity including a zero-length datagram", () => {
    const recorder = new CaptureRecorder({
      sessionId: "zero-datagram-session",
      title: "Zero datagram",
      startedAt: "2026-07-16T00:00:00.000Z",
      displayTimeZone: "UTC",
      source: { id: "udp-source", kind: "udp", label: "UDP", address: "127.0.0.1", port: 9_104 },
    });
    recorder.append({ offsetUs: 0, bytes: new Uint8Array(), wireBytes: 0 });
    recorder.append({ offsetUs: 10, bytes: Uint8Array.from([1, 2, 3, 4]), wireBytes: 4 });

    expect(() => assertUdpCaptureIntegrity(
      bridgeStatus("owned", { datagrams: 2, bytes: 4 }, "stopped"),
      "owned",
      {
        observedDatagrams: 2,
        observedBytes: 4,
        retainedRecords: recorder.recordCount,
        retainedBytes: recorder.capturedBytes,
        lastSequence: 1,
        sequenceIssue: null,
      },
    )).not.toThrow();
  });

  it("accepts owned datagrams that arrived during the normal stop drain", () => {
    expect(() => assertUdpCaptureIntegrity(
      bridgeStatus("owned", { datagrams: 3, bytes: 6 }, "stopped"),
      "owned",
      {
        observedDatagrams: 3,
        observedBytes: 6,
        retainedRecords: 3,
        retainedBytes: 6,
        lastSequence: 2,
        sequenceIssue: null,
      },
    )).not.toThrow();
  });

  it("refuses clean save for a missed SSE event or retention mismatch", () => {
    expect(() => assertUdpCaptureIntegrity(
      bridgeStatus("owned", { datagrams: 3, bytes: 6 }, "stopped"),
      "owned",
      {
        observedDatagrams: 2,
        observedBytes: 4,
        retainedRecords: 1,
        retainedBytes: 2,
        lastSequence: 2,
        sequenceIssue: "SSE sequence 2 arrived where 1 was expected",
      },
    )).toThrow(UdpCaptureIntegrityError);
  });

  it("refuses clean save when the bridge final state is abnormal or fatal", () => {
    const snapshot = {
      observedDatagrams: 1,
      observedBytes: 2,
      retainedRecords: 1,
      retainedBytes: 2,
      lastSequence: 0,
      sequenceIssue: null,
    };
    expect(() => assertUdpCaptureIntegrity(
      bridgeStatus("owned", { datagrams: 1, bytes: 2 }, "error"),
      "owned",
      snapshot,
    )).toThrow("instead of stopped");

    const fatal = bridgeStatus("owned", { datagrams: 1, bytes: 2 }, "stopped");
    fatal.lastError = {
      protocolVersion: 1,
      code: "socket-failed",
      message: "Socket closed unexpectedly",
      at: "2026-07-16T00:00:01.000Z",
      fatal: true,
    };
    expect(() => assertUdpCaptureIntegrity(fatal, "owned", snapshot)).toThrow("fatal socket-failed");
  });
});

describe("CaptureDialog duration", () => {
  it("advances a quiet capture from its monotonic origin", () => {
    expect(monotonicCaptureDurationUs(1_000, 2_500, 0, 0)).toBe(1_500_000);
    expect(monotonicCaptureDurationUs(1_000, 2_500, 2_000_000, 900_000)).toBe(2_000_000);
  });

  it("uses the verified bridge end and last retained offset after stop drain", () => {
    expect(verifiedCaptureDurationUs({
      frozenDurationUs: 100,
      bridgeDurationUs: 250,
      bridgeDatagrams: 2,
      lastRetainedOffsetUs: 300,
    })).toBe(301);
    expect(verifiedCaptureDurationUs({
      frozenDurationUs: 100,
      bridgeDurationUs: 400,
      bridgeDatagrams: 2,
      lastRetainedOffsetUs: 300,
    })).toBe(401);
  });

  it("marks an over-limit duration as capped instead of silently treating it as clean", () => {
    expect(boundFinalizationDuration(86_400_000_001, 86_400_000_000)).toEqual({
      durationUs: 86_400_000_000,
      wasCapped: true,
    });
    expect(boundFinalizationDuration(86_400_000_000, 86_400_000_000)).toEqual({
      durationUs: 86_400_000_000,
      wasCapped: false,
    });
  });
});

describe("CaptureDialog finalization recovery", () => {
  it("keeps an empty recorder recoverable after finalize fails", () => {
    const recorder = new CaptureRecorder({
      sessionId: "empty-recovery-session",
      title: "Empty recovery",
      startedAt: "2026-07-16T00:00:00.000Z",
      displayTimeZone: "UTC",
      source: { id: "udp-source", kind: "udp", label: "UDP", address: "127.0.0.1", port: 9_104 },
    });
    expect(() => recorder.finalize(1)).toThrow("Cannot finalize an empty capture");
    recorder.append({ offsetUs: 0, bytes: Uint8Array.from([1]), wireBytes: 1 });
    expect(recorder.finalize(1).records).toHaveLength(1);
  });

  it("preserves absent UDP bridge terminal totals and finalizes an explicitly incomplete receipt", () => {
    const recorder = new CaptureRecorder({
      sessionId: "udp-stop-failure",
      title: "UDP stop failure",
      startedAt: "2026-07-16T00:00:00.000Z",
      displayTimeZone: "UTC",
      source: { id: "udp-source", kind: "udp", label: "UDP", address: "127.0.0.1", port: 9_104 },
    });
    recorder.append({ offsetUs: 0, bytes: Uint8Array.from([1, 2]), wireBytes: 2 });
    const evidence = captureFinalizationEvidence({
      transport: "udp",
      durationUs: 10,
      stopDisposition: "unconfirmed",
      eventLogComplete: true,
      observedUnits: 1,
      observedBytes: 2,
      transportReportedUnits: null,
      transportReportedBytes: null,
      shutdown: {
        code: "bridge-unreachable",
        message: "The bridge did not return terminal status.",
      },
    });

    expect(evidence).toMatchObject({
      observedUnits: 1,
      observedBytes: 2,
      transportReportedUnits: null,
      transportReportedBytes: null,
    });
    const document = recorder.finalize(10, evidence);
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");
    expect(document.captureIntegrity).toMatchObject({
      status: "incomplete",
      assessmentBasis: "udp-browser-observed",
      stopDisposition: "unconfirmed",
      eventLogComplete: true,
      input: {
        observedUnits: 1,
        observedBytes: 2,
        transportReportedUnits: null,
        transportReportedBytes: null,
      },
      issueCodes: ["shutdown-unconfirmed"],
    });
    expect(document.transportEvents).toEqual([expect.objectContaining({
      type: "shutdown-unconfirmed",
      code: "bridge-unreachable",
    })]);
  });

  it("flushes the owned pre-status buffer while overflow pauses only future retention", () => {
    const recorder = new CaptureRecorder({
      sessionId: "udp-prestatus-overflow",
      title: "UDP pre-status overflow",
      startedAt: "2026-07-16T00:00:00.000Z",
      displayTimeZone: "UTC",
      source: { id: "udp-source", kind: "udp", label: "UDP", address: "127.0.0.1", port: 9_104 },
    });
    recorder.appendTransportEvent({
      type: "capture-backpressure",
      transport: "udp",
      scope: { kind: "session" },
      severity: "critical",
      message: "Early UDP datagrams exceeded the local pre-status buffer limit.",
      component: "udp-prestatus-buffer",
      limit: "records",
      limitValue: 100_000,
      observedValue: 100_001,
    });
    const buffered = [bridgeDatagram(0, [1, 2]), bridgeDatagram(1, [3, 4])];
    let observedUnits = 0;
    let observedBytes = 0;
    const ingestPaused = true;
    const accept = (datagram: UdpBridgeDatagram, allowPausedRetention: boolean): boolean => {
      observedUnits += 1;
      observedBytes += datagram.byteLength;
      if (!canRetainCapturedInput(
        false,
        ingestPaused,
        allowPausedRetention ? "pre-status-buffer" : "live",
      )) return false;
      recorder.append({ offsetUs: datagram.offsetUs, bytes: datagram.data, wireBytes: datagram.byteLength });
      return true;
    };

    expect(flushOwnedBufferedUdpDatagrams(buffered, "owned", accept)).toEqual({ observed: 2, retained: 2 });
    expect(recorder.recordCount).toBe(2);
    expect(recorder.capturedBytes).toBe(4);

    const future = bridgeDatagram(2, [5, 6]);
    expect(accept(future, false)).toBe(false);
    expect(recorder.recordCount).toBe(2);

    const document = recorder.finalize(10, {
      stopDisposition: "confirmed",
      stopOffsetUs: 10,
      eventLogComplete: true,
      observedUnits,
      observedBytes,
      transportReportedUnits: observedUnits,
      transportReportedBytes: observedBytes,
    });
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");
    expect(document.records.map((record) => record.dataHex)).toEqual(["0102", "0304"]);
    expect(document.captureIntegrity).toMatchObject({
      status: "incomplete",
      retained: { records: 2, bytes: 4 },
      issueCodes: ["udp-counter-mismatch", "capture-backpressure"],
    });
  });

  it("deduplicates duration-limit evidence and finalizes over-limit input as incomplete", () => {
    const recorder = new CaptureRecorder({
      sessionId: "udp-duration-limit",
      title: "UDP duration limit",
      startedAt: "2026-07-16T00:00:00.000Z",
      displayTimeZone: "UTC",
      source: { id: "udp-source", kind: "udp", label: "UDP", address: "127.0.0.1", port: 9_104 },
      limits: { maxDurationUs: 10 },
    });
    recorder.append({ offsetUs: 0, bytes: Uint8Array.from([1]), wireBytes: 1 });
    let limitError: CaptureRecorderError | null = null;
    try {
      recorder.append({ offsetUs: 10, bytes: Uint8Array.from([2]), wireBytes: 1 });
    } catch (cause) {
      if (!(cause instanceof CaptureRecorderError)) throw cause;
      limitError = cause;
    }
    expect(limitError).toMatchObject({ limit: "duration", limitValue: 10, observedValue: 10 });
    recorder.appendTransportEvent({
      type: "capture-limit",
      transport: "udp",
      scope: { kind: "point", offsetUs: 9 },
      severity: "critical",
      message: limitError?.message ?? "Capture duration limit reached.",
      component: "recorder",
      limit: "duration",
      limitValue: 10,
      observedValue: 10,
    });

    const bounded = boundFinalizationDuration(11, recorder.limits.maxDurationUs);
    expect(bounded).toEqual({ durationUs: 10, wasCapped: true });
    expect(ensureDurationLimitTransportEvent(recorder, {
      alreadyRecorded: true,
      transport: "udp",
      maximumDurationUs: recorder.limits.maxDurationUs,
      observedDurationUs: 11,
      message: "Capture duration was capped.",
    })).toBe(true);
    expect(recorder.transportEventCount).toBe(1);

    const document = recorder.finalize(bounded.durationUs, {
      stopDisposition: "confirmed",
      stopOffsetUs: bounded.durationUs,
      eventLogComplete: true,
      observedUnits: 2,
      observedBytes: 2,
      transportReportedUnits: 2,
      transportReportedBytes: 2,
      issueCodes: ["duration-capped"],
    });
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");
    expect(document.transportEvents.filter(
      (event) => event.type === "capture-limit" && event.limit === "duration",
    )).toHaveLength(1);
    expect(document.captureIntegrity).toMatchObject({
      status: "incomplete",
      retained: { records: 1, bytes: 1 },
      issueCodes: ["udp-counter-mismatch", "capture-limit", "duration-capped"],
    });
  });

  it("retains the assembled serial tail after a normal confirmed stop", () => {
    const recorder = new CaptureRecorder({
      sessionId: "serial-normal-tail",
      title: "Serial normal tail",
      startedAt: "2026-07-16T00:00:00.000Z",
      displayTimeZone: "UTC",
      source: { id: "serial-source", kind: "serial", label: "Serial" },
    });
    const assembler = new Nsl01SerialFrameAssembler();
    const observedTail = Uint8Array.from([0xa5, 0x5a, 0x02]);
    expect(assembler.push(observedTail, 7)).toEqual([]);

    const retained = retainSerialAssemblerTail(assembler, (input, origin) => {
      expect(canRetainCapturedInput(true, false, origin)).toBe(true);
      recorder.append(input);
      return true;
    });
    expect(retained).toEqual({ records: 1, bytes: observedTail.byteLength });

    const document = recorder.finalize(10, {
      stopDisposition: "confirmed",
      stopOffsetUs: 10,
      eventLogComplete: true,
      observedUnits: 1,
      observedBytes: observedTail.byteLength,
      transportReportedUnits: null,
      transportReportedBytes: null,
    });
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");
    expect(document.records).toEqual([expect.objectContaining({ dataHex: "A55A02", captureBytes: 3 })]);
    expect(document.captureIntegrity).toMatchObject({
      status: "verified",
      assessmentBasis: "web-serial-observed",
      input: { observedUnits: 1, observedBytes: 3 },
      retained: { records: 1, bytes: 3 },
      issueCodes: [],
    });
  });

  it("retains the assembled serial tail when transport stop fails", () => {
    const recorder = new CaptureRecorder({
      sessionId: "serial-failed-stop-tail",
      title: "Serial failed-stop tail",
      startedAt: "2026-07-16T00:00:00.000Z",
      displayTimeZone: "UTC",
      source: { id: "serial-source", kind: "serial", label: "Serial" },
    });
    const assembler = new Nsl01SerialFrameAssembler();
    const observedTail = Uint8Array.from([0xa5]);
    expect(assembler.push(observedTail, 4)).toEqual([]);

    const retained = retainSerialAssemblerTail(assembler, (input, origin) => {
      expect(canRetainCapturedInput(true, false, origin)).toBe(true);
      recorder.append(input);
      return true;
    });
    expect(retained).toEqual({ records: 1, bytes: observedTail.byteLength });

    const document = recorder.finalize(5, {
      stopDisposition: "unconfirmed",
      stopOffsetUs: 5,
      eventLogComplete: true,
      observedUnits: 1,
      observedBytes: observedTail.byteLength,
      transportReportedUnits: null,
      transportReportedBytes: null,
      shutdown: {
        code: "serial-stop-failed",
        message: "The serial device did not confirm a clean stop.",
      },
    });
    if (document.formatVersion !== 2) throw new Error("Expected a version 2 capture");
    expect(document.records).toEqual([expect.objectContaining({ dataHex: "A5", captureBytes: 1 })]);
    expect(document.captureIntegrity).toMatchObject({
      status: "incomplete",
      assessmentBasis: "web-serial-observed",
      stopDisposition: "unconfirmed",
      input: { observedUnits: 1, observedBytes: 1 },
      retained: { records: 1, bytes: 1 },
      issueCodes: ["shutdown-unconfirmed"],
    });
  });
});

describe("CaptureDialog durable event drafts", () => {
  it("preserves the exact UDP discontinuity offset and sequence evidence", () => {
    expect(udpSequenceDiscontinuityEvent({ offsetUs: 25_000, sequence: 7 }, 5)).toEqual({
      type: "udp-event-sequence-discontinuity",
      transport: "udp",
      scope: { kind: "point", offsetUs: 25_000 },
      severity: "critical",
      message: "UDP event-stream sequence 7 arrived where 5 was expected.",
      expectedSequence: 5,
      observedSequence: 7,
    });
  });

  it("preserves the exact serial failure offset and bounded cause", () => {
    expect(serialTransportFailureEvent(
      "serial-disconnected",
      40_000,
      "The serial stream ended unexpectedly.",
      "serial-stream-ended",
    )).toEqual({
      type: "serial-disconnected",
      transport: "serial",
      scope: { kind: "point", offsetUs: 40_000 },
      severity: "critical",
      message: "The serial stream ended unexpectedly.",
      code: "serial-stream-ended",
    });
  });
});
