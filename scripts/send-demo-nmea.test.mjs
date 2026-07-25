import { describe, expect, it } from "vitest";

import { buildNmeaDemoDatagrams, parseNmeaDemoArguments } from "./send-demo-nmea.mjs";

describe("NMEA demo sender", () => {
  it("parses bounded command options", () => {
    expect(parseNmeaDemoArguments([])).toEqual({
      host: "127.0.0.1",
      port: 9_104,
      records: 30,
      intervalMs: 200,
    });
    expect(parseNmeaDemoArguments(["--port", "9201", "--records", "3", "--interval-ms", "0"]))
      .toMatchObject({ port: 9_201, records: 3, intervalMs: 0 });
    expect(() => parseNmeaDemoArguments(["--port", "70000"])).toThrow("Port must be an integer");
  });

  it("emits complete, checksummed ASCII NMEA datagrams", () => {
    const datagrams = buildNmeaDemoDatagrams(3).map((bytes) => bytes.toString("ascii"));

    expect(datagrams).toHaveLength(3);
    expect(datagrams[0]).toBe("$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47\r\n");
    expect(datagrams[1]).toBe("$GPRMC,123520,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*60\r\n");
    expect(datagrams[2]).toBe("$GPHDT,123.4,T*31\r\n");
  });
});
