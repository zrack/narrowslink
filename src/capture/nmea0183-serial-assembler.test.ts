import { describe, expect, it } from "vitest";

import { Nmea0183SerialLineAssembler } from "./nmea0183-serial-assembler";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("Nmea0183SerialLineAssembler", () => {
  it("reassembles split line-feed-delimited sentences without changing bytes", () => {
    const assembler = new Nmea0183SerialLineAssembler(256);

    expect(assembler.push(encoder.encode("$GPHDT,12"), 100)).toEqual([]);
    const records = assembler.push(encoder.encode("3.4,T*31\r\n$GPGGA,1*00\n"), 200);

    expect(records).toHaveLength(2);
    expect(decoder.decode(records[0]?.bytes)).toBe("$GPHDT,123.4,T*31\r\n");
    expect(records[0]?.offsetUs).toBe(100);
    expect(decoder.decode(records[1]?.bytes)).toBe("$GPGGA,1*00\n");
    expect(records[1]?.offsetUs).toBe(200);
  });

  it("retains an unterminated tail and bounds overlong input", () => {
    const assembler = new Nmea0183SerialLineAssembler(8);

    const records = assembler.push(encoder.encode("$TOO-LONG-TAIL"), 400);
    const tail = assembler.finish();

    expect(records.map((record) => record.bytes.byteLength)).toEqual([8]);
    expect(tail.map((record) => record.bytes.byteLength)).toEqual([6]);
    expect([...records, ...tail].every((record) => record.kind === "partial")).toBe(true);
    expect(decoder.decode(Uint8Array.from([...records[0]!.bytes, ...tail[0]!.bytes]))).toBe("$TOO-LONG-TAIL");
  });
});
