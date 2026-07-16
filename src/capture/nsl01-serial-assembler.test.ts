import { describe, expect, it } from "vitest";

import { bytesToHex, encodeFrame } from "../domain/decoder";
import { parseSession } from "../domain/session";
import {
  MAX_NSL01_SERIAL_FRAME_BYTES,
  MAX_NSL01_SERIAL_PAYLOAD_BYTES,
  Nsl01SerialFrameAssembler,
  SerialFrameAssemblerError,
} from "./nsl01-serial-assembler";
import { CaptureRecorder, MAX_CAPTURE_RECORD_BYTES } from "./recorder";

function concat(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function serialRecorder(): CaptureRecorder {
  return new CaptureRecorder({
    sessionId: "serial-capture",
    title: "NSL-01 serial capture",
    startedAt: "2026-07-16T01:00:00.000Z",
    displayTimeZone: "UTC",
    source: { id: "serial-live", kind: "serial", label: "USB serial · 115200 baud" },
  });
}

function heartbeat(sequence: number): Uint8Array {
  return encodeFrame({
    familyId: 0x02,
    sequence,
    deviceTimeMs: sequence,
    payload: new Uint8Array(8),
  });
}

function declaredFrameHeader(payloadLength: number): Uint8Array {
  const header = new Uint8Array(12);
  header.set([0xa5, 0x5a, 0x01, 0x02]);
  new DataView(header.buffer).setUint16(6, payloadLength, true);
  return header;
}

describe("Nsl01SerialFrameAssembler", () => {
  it("reassembles split and adjacent frames while retaining noise and the final partial sync", () => {
    const assembler = new Nsl01SerialFrameAssembler();
    const first = heartbeat(1);
    const second = heartbeat(2);

    const initial = assembler.push(concat(new Uint8Array([0x00, 0xff]), first.slice(0, 1)), 0);
    const remaining = assembler.push(concat(
      first.slice(1),
      second,
      new Uint8Array([0x13, 0x37, 0xa5]),
    ), 1_000);
    const final = assembler.finish();
    const records = [...initial, ...remaining, ...final];

    expect(records.map((record) => record.kind)).toEqual(["noise", "frame", "frame", "noise", "partial"]);
    expect(records.map((record) => record.offsetUs)).toEqual([0, 0, 1_000, 1_000, 1_000]);
    expect(bytesToHex(records[1]!.bytes)).toBe(bytesToHex(first));
    expect(bytesToHex(records[2]!.bytes)).toBe(bytesToHex(second));
    expect([...records[4]!.bytes]).toEqual([0xa5]);

    const recorder = serialRecorder();
    for (const record of records) recorder.append({ offsetUs: record.offsetUs, bytes: record.bytes });
    const parsed = parseSession(recorder.finalize(2_000));

    expect(parsed.frames.map((frame) => frame.status)).toEqual(["partial", "complete", "complete", "partial", "partial"]);
    expect(parsed.diagnostics.filter((event) => event.type === "partial-frame")).toHaveLength(3);
  });

  it("emits an incomplete frame intact when the serial stream stops", () => {
    const assembler = new Nsl01SerialFrameAssembler();
    const partial = heartbeat(8).slice(0, 15);

    expect(assembler.push(partial, 5)).toEqual([]);
    const records = assembler.finish();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: "partial", offsetUs: 5 });
    expect(bytesToHex(records[0]!.bytes)).toBe(bytesToHex(partial));
  });

  it("retains an impossible false header as noise and parses a following valid frame", () => {
    const assembler = new Nsl01SerialFrameAssembler();
    const falseHeader = declaredFrameHeader(0xffff);
    const validFrame = heartbeat(9);

    const records = assembler.push(concat(falseHeader, validFrame), 25);

    expect(records.map((record) => record.kind)).toEqual(["noise", "frame"]);
    expect(records.map((record) => record.offsetUs)).toEqual([25, 25]);
    expect(bytesToHex(records[0]!.bytes)).toBe(bytesToHex(falseHeader));
    expect(bytesToHex(records[1]!.bytes)).toBe(bytesToHex(validFrame));
    expect(assembler.bufferedBytes).toBe(0);
    expect(assembler.finish()).toEqual([]);
  });

  it("rejects an impossible declaration as soon as its header is complete", () => {
    const assembler = new Nsl01SerialFrameAssembler();
    const falseHeader = declaredFrameHeader(MAX_NSL01_SERIAL_PAYLOAD_BYTES + 1);

    const rejected = assembler.push(falseHeader, 30);
    const recovered = assembler.push(heartbeat(10), 40);

    expect(MAX_NSL01_SERIAL_FRAME_BYTES).toBeLessThanOrEqual(MAX_CAPTURE_RECORD_BYTES);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ kind: "noise", offsetUs: 30 });
    expect(bytesToHex(rejected[0]!.bytes)).toBe(bytesToHex(falseHeader));
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ kind: "frame", offsetUs: 40 });
    expect(assembler.bufferedBytes).toBe(0);
  });

  it("splits long noise into schema-compatible records without dropping a byte", () => {
    const assembler = new Nsl01SerialFrameAssembler();
    const noise = new Uint8Array(MAX_CAPTURE_RECORD_BYTES + 17).fill(0x11);

    const records = assembler.push(noise, 12);

    expect(records.map((record) => record.kind)).toEqual(["noise", "noise"]);
    expect(records.map((record) => record.bytes.length)).toEqual([MAX_CAPTURE_RECORD_BYTES, 17]);
    expect(records.reduce((total, record) => total + record.bytes.length, 0)).toBe(noise.length);
  });

  it("rejects non-monotonic timestamps and input after the stream finishes", () => {
    const assembler = new Nsl01SerialFrameAssembler();
    assembler.push(new Uint8Array([1]), 10);
    expect(() => assembler.push(new Uint8Array([2]), 9)).toThrow("must be monotonic");
    assembler.finish();

    expect(() => assembler.push(new Uint8Array([3]), 11)).toThrow(SerialFrameAssemblerError);
    expect(() => assembler.finish()).toThrow("already finished");
  });
});
