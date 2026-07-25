import { bytesToHex, decodeRecord } from "../domain/decoder";
import type { DecoderPackDocument } from "../domain/decoder-pack";
import type { SourceRecord, UdpRemoteEndpoint } from "../domain/types";

export const MAX_PREFLIGHT_ANALYZED_RECORDS = 256;
export const MAX_PREFLIGHT_ANALYZED_BYTES = 512 * 1024;
export const MAX_PREFLIGHT_ENDPOINTS = 16;

export type PreflightReadiness = "waiting" | "ready" | "attention";
export type PreflightDecoderFit = "not-observed" | "confirmed" | "not-confirmed";

export interface CapturePreflightSummary {
  readonly connected: boolean;
  readonly elapsedMs: number;
  readonly inputUnits: number;
  readonly inputBytes: number;
  readonly unitRate: number;
  readonly byteRate: number;
  readonly lastInputAgeMs: number | null;
  readonly analyzedRecords: number;
  readonly analyzedBytes: number;
  readonly completeFrames: number;
  readonly malformedFrames: number;
  readonly checksumFailures: number;
  readonly families: readonly { name: string; count: number }[];
  readonly endpoints: readonly UdpRemoteEndpoint[];
  readonly omittedEndpoints: number;
  readonly analysisLimited: boolean;
  readonly readiness: PreflightReadiness;
  readonly decoderFit: PreflightDecoderFit;
  readonly message: string;
}

export interface PreflightRecordInput {
  readonly bytes: Uint8Array;
  readonly offsetUs: number;
  readonly transport: "udp" | "serial";
  readonly remoteEndpoint?: UdpRemoteEndpoint;
}

function endpointKey(endpoint: UdpRemoteEndpoint): string {
  return `${endpoint.family}\u0000${endpoint.address}\u0000${endpoint.port}`;
}

function boundedElapsed(startedAtMs: number, nowMs: number): number {
  if (!Number.isFinite(nowMs)) return 0;
  return Math.max(0, nowMs - startedAtMs);
}

export class CapturePreflightAnalyzer {
  private inputUnits = 0;
  private inputBytes = 0;
  private lastInputAtMs: number | null = null;
  private analyzedRecords = 0;
  private analyzedBytes = 0;
  private completeFrames = 0;
  private malformedFrames = 0;
  private checksumFailures = 0;
  private analysisLimited = false;
  private readonly familyCounts = new Map<string, number>();
  private readonly endpoints = new Map<string, UdpRemoteEndpoint>();
  private omittedEndpoints = 0;

  constructor(
    private readonly decoderPack: DecoderPackDocument,
    private readonly startedAtMs: number,
  ) {}

  observeInput(byteLength: number, observedAtMs: number): void {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new Error("Preflight input byte lengths must be non-negative integers.");
    }
    this.inputUnits += 1;
    this.inputBytes += byteLength;
    this.lastInputAtMs = Math.max(this.lastInputAtMs ?? observedAtMs, observedAtMs);
  }

  observeRecord(input: PreflightRecordInput): void {
    if (!(input.bytes instanceof Uint8Array)) {
      throw new Error("Preflight records must contain Uint8Array bytes.");
    }
    if (!Number.isSafeInteger(input.offsetUs) || input.offsetUs < 0) {
      throw new Error("Preflight record offsets must be non-negative integer microseconds.");
    }
    if (
      this.analyzedRecords >= MAX_PREFLIGHT_ANALYZED_RECORDS
      || this.analyzedBytes + input.bytes.byteLength > MAX_PREFLIGHT_ANALYZED_BYTES
    ) {
      this.analysisLimited = true;
      return;
    }

    const record: SourceRecord = {
      id: `preflight-${this.analyzedRecords}`,
      index: this.analyzedRecords,
      sourceId: "preflight",
      offsetUs: input.offsetUs,
      dataHex: bytesToHex(input.bytes),
      captureBytes: input.bytes.byteLength,
      wireBytes: input.bytes.byteLength,
      transport: {
        kind: input.transport,
        ...(input.remoteEndpoint ? { remoteEndpoint: input.remoteEndpoint } : {}),
      },
    };
    const frame = decodeRecord(record, this.analyzedRecords, this.decoderPack);
    this.analyzedRecords += 1;
    this.analyzedBytes += input.bytes.byteLength;
    if (frame.status === "complete" && frame.integrity.status === "valid") {
      this.completeFrames += 1;
    } else {
      this.malformedFrames += 1;
      if (frame.integrity.status === "crc-failed" || frame.integrity.status === "checksum-failed") {
        this.checksumFailures += 1;
      }
    }
    this.familyCounts.set(frame.familyName, (this.familyCounts.get(frame.familyName) ?? 0) + 1);

    if (input.remoteEndpoint) {
      const key = endpointKey(input.remoteEndpoint);
      if (!this.endpoints.has(key)) {
        if (this.endpoints.size < MAX_PREFLIGHT_ENDPOINTS) {
          this.endpoints.set(key, { ...input.remoteEndpoint });
        } else {
          this.omittedEndpoints += 1;
        }
      }
    }
  }

  snapshot(nowMs: number, connected: boolean): CapturePreflightSummary {
    const elapsedMs = boundedElapsed(this.startedAtMs, nowMs);
    const elapsedSeconds = Math.max(elapsedMs / 1_000, 0.001);
    const lastInputAgeMs = this.lastInputAtMs == null
      ? null
      : Math.max(0, nowMs - this.lastInputAtMs);
    const families = [...this.familyCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "en"));

    let readiness: PreflightReadiness;
    let decoderFit: PreflightDecoderFit;
    let message: string;
    if (!connected) {
      readiness = "waiting";
      decoderFit = "not-observed";
      message = "Opening the local source.";
    } else if (this.inputUnits === 0) {
      readiness = "waiting";
      decoderFit = "not-observed";
      message = elapsedMs >= 10_000
        ? "No traffic observed. Check the sender, bind or multicast interface, cable, and radio link."
        : "Source is open; waiting for traffic.";
    } else if (this.completeFrames === 0) {
      readiness = "attention";
      decoderFit = "not-confirmed";
      message = this.analyzedRecords === 0
        ? "Traffic is arriving, but no complete record boundary has been observed."
        : "Traffic is arriving, but the selected decoder has not produced a valid frame. Check decoder, framing, and serial settings.";
    } else {
      decoderFit = "confirmed";
      const malformedRatio = this.malformedFrames / Math.max(1, this.analyzedRecords);
      readiness = malformedRatio > 0.5 ? "attention" : "ready";
      message = readiness === "ready"
        ? "Traffic and decoder fit are confirmed."
        : "Valid frames are present, but most observed records are malformed. Recording remains available with an explicit warning.";
    }

    return {
      connected,
      elapsedMs,
      inputUnits: this.inputUnits,
      inputBytes: this.inputBytes,
      unitRate: this.inputUnits / elapsedSeconds,
      byteRate: this.inputBytes / elapsedSeconds,
      lastInputAgeMs,
      analyzedRecords: this.analyzedRecords,
      analyzedBytes: this.analyzedBytes,
      completeFrames: this.completeFrames,
      malformedFrames: this.malformedFrames,
      checksumFailures: this.checksumFailures,
      families,
      endpoints: [...this.endpoints.values()],
      omittedEndpoints: this.omittedEndpoints,
      analysisLimited: this.analysisLimited,
      readiness,
      decoderFit,
      message,
    };
  }
}
