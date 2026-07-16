import { describe, expect, it, vi } from "vitest";

import {
  assertUdpCaptureIntegrity,
  boundFinalizationDuration,
  monotonicCaptureDurationUs,
  stopUdpCaptureIfOwned,
  UdpCaptureIntegrityError,
  UdpCaptureOwnershipError,
  verifiedCaptureDurationUs,
} from "./CaptureDialog";
import { CaptureRecorder } from "./recorder";
import type { UdpBridgeStatus } from "./udp-bridge";

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
});
