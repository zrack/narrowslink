import { describe, expect, it } from "vitest";

import {
  NMEA0183_DECODER_PACK,
  NSL01_DECODER_PACK,
  encodeFrame,
  hexToBytes,
} from "../domain/decoder";
import {
  CapturePreflightAnalyzer,
  MAX_PREFLIGHT_ANALYZED_RECORDS,
} from "./capture-preflight";

function heartbeatFrame(): Uint8Array {
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  view.setUint32(0, 20, true);
  payload[4] = 2;
  view.setUint16(6, 0x0137, true);
  return encodeFrame({
    familyId: 0x02,
    sequence: 1,
    deviceTimeMs: 20,
    payload,
  });
}

describe("capture preflight analysis", () => {
  it("confirms transport and decoder fit without retaining payload bytes", () => {
    const analyzer = new CapturePreflightAnalyzer(NSL01_DECODER_PACK, 1_000);
    const bytes = heartbeatFrame();
    analyzer.observeInput(bytes.byteLength, 1_100);
    analyzer.observeRecord({
      bytes,
      offsetUs: 100_000,
      transport: "udp",
      remoteEndpoint: { address: "127.0.0.1", port: 9_104, family: "IPv4" },
    });

    expect(analyzer.snapshot(2_000, true)).toMatchObject({
      connected: true,
      inputUnits: 1,
      inputBytes: bytes.byteLength,
      completeFrames: 1,
      malformedFrames: 0,
      readiness: "ready",
      decoderFit: "confirmed",
      families: [{ name: "Heartbeat", count: 1 }],
      endpoints: [{ address: "127.0.0.1", port: 9_104, family: "IPv4" }],
    });
    expect(Object.keys(analyzer.snapshot(2_000, true))).not.toContain("records");
  });

  it("distinguishes no traffic from traffic that does not fit the decoder", () => {
    const waiting = new CapturePreflightAnalyzer(NMEA0183_DECODER_PACK, 0);
    expect(waiting.snapshot(10_001, true)).toMatchObject({
      readiness: "waiting",
      decoderFit: "not-observed",
      message: expect.stringContaining("No traffic observed"),
    });

    const mismatch = new CapturePreflightAnalyzer(NMEA0183_DECODER_PACK, 0);
    const noise = new TextEncoder().encode("not nmea\r\n");
    mismatch.observeInput(noise.byteLength, 100);
    mismatch.observeRecord({ bytes: noise, offsetUs: 100_000, transport: "serial" });
    expect(mismatch.snapshot(1_000, true)).toMatchObject({
      readiness: "attention",
      decoderFit: "not-confirmed",
      completeFrames: 0,
      malformedFrames: 1,
    });
  });

  it("reports checksum failures and valid NMEA sentence families", () => {
    const analyzer = new CapturePreflightAnalyzer(NMEA0183_DECODER_PACK, 0);
    const valid = hexToBytes(NMEA0183_DECODER_PACK.fixtures[0]!.records[0]!.dataHex);
    const invalid = hexToBytes(NMEA0183_DECODER_PACK.fixtures[2]!.records[0]!.dataHex);
    for (const [index, bytes] of [valid, invalid].entries()) {
      analyzer.observeInput(bytes.byteLength, index * 100);
      analyzer.observeRecord({ bytes, offsetUs: index * 100_000, transport: "udp" });
    }
    expect(analyzer.snapshot(1_000, true)).toMatchObject({
      completeFrames: 1,
      malformedFrames: 1,
      checksumFailures: 1,
      decoderFit: "confirmed",
    });
  });

  it("bounds analysis while continuing to count observed input", () => {
    const analyzer = new CapturePreflightAnalyzer(NSL01_DECODER_PACK, 0);
    const bytes = heartbeatFrame();
    for (let index = 0; index < MAX_PREFLIGHT_ANALYZED_RECORDS + 2; index += 1) {
      analyzer.observeInput(bytes.byteLength, index);
      analyzer.observeRecord({ bytes, offsetUs: index, transport: "udp" });
    }
    expect(analyzer.snapshot(1_000, true)).toMatchObject({
      inputUnits: MAX_PREFLIGHT_ANALYZED_RECORDS + 2,
      analyzedRecords: MAX_PREFLIGHT_ANALYZED_RECORDS,
      analysisLimited: true,
    });
  });
});
