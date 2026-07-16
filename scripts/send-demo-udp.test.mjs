import { describe, expect, it } from "vitest";

import { parseDemoArguments } from "./send-demo-udp.mjs";

describe("parseDemoArguments", () => {
  it("provides safe loopback demo defaults", () => {
    expect(parseDemoArguments([])).toEqual({
      host: "127.0.0.1",
      intervalMs: 5,
      port: 9_104,
      records: 480,
      startIndex: 0,
    });
  });

  it("accepts bounded overrides", () => {
    expect(parseDemoArguments(["--port", "9201", "--records", "12", "--interval-ms", "0"])).toMatchObject({
      port: 9_201,
      records: 12,
      intervalMs: 0,
    });
  });

  it("rejects invalid ports and unknown options", () => {
    expect(() => parseDemoArguments(["--port", "70000"])).toThrow("Port must be an integer");
    expect(() => parseDemoArguments(["--wat", "1"])).toThrow("Unknown option");
  });
});
