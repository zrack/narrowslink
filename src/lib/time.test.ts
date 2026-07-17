import { describe, expect, it } from "vitest";

import { formatOffsetUsInput, parseOffsetUsInput } from "./time";

describe("incident offset input", () => {
  it("formats and parses exact integer microseconds", () => {
    const offsetUs = 3_721_000_042;

    expect(formatOffsetUsInput(offsetUs)).toBe("01:02:01.000042");
    expect(parseOffsetUsInput("01:02:01.000042")).toBe(offsetUs);
  });

  it("supports the complete 24-hour session boundary", () => {
    expect(formatOffsetUsInput(0)).toBe("00:00:00.000000");
    expect(parseOffsetUsInput("24:00:00.000000")).toBe(86_400_000_000);
    expect(parseOffsetUsInput("2:20:35.5")).toBe(8_435_500_000);
  });

  it("rejects malformed or non-clock values", () => {
    expect(parseOffsetUsInput("23:60:00.000000")).toBeNull();
    expect(parseOffsetUsInput("23:00:60.000000")).toBeNull();
    expect(parseOffsetUsInput("not a time")).toBeNull();
    expect(() => formatOffsetUsInput(-1)).toThrow(RangeError);
    expect(() => formatOffsetUsInput(1.5)).toThrow(RangeError);
  });
});
