import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseSession } from "./session";

describe("checked-in harbor relay replay", () => {
  it("validates and decodes the complete fixture while retaining malformed frames", () => {
    const fixtureUrl = new URL("../../public/fixtures/harbor-relay-session.json", import.meta.url);
    const sourceDocument: unknown = JSON.parse(readFileSync(fixtureUrl, "utf8"));

    const session = parseSession(sourceDocument);

    expect(session.document.id).toBe("harbor-relay-2026-07-15-213812");
    expect(session.document.records).toHaveLength(18_402);
    expect(session.frames).toHaveLength(18_402);
    expect(session.buckets).toHaveLength(8_435);
    expect(session.incidents.map((incident) => incident.id)).toEqual(["fade", "interference", "schema"]);
    expect(session.incidents.every((incident) => incident.stats.receivedFrames > 0)).toBe(true);

    const malformedFrames = session.frames.filter((frame) => frame.status !== "complete");
    expect(malformedFrames.length).toBeGreaterThan(0);
    expect(new Set(malformedFrames.map((frame) => frame.status))).toEqual(new Set(["invalid", "partial"]));
    expect(malformedFrames.every((frame) => session.framesById.get(frame.id) === frame)).toBe(true);
    expect(malformedFrames.every((frame) => frame.sourceRecord === session.document.records[frame.ordinal])).toBe(true);
    expect(session.diagnostics.some((event) => event.type === "crc-failure")).toBe(true);
    expect(session.diagnostics.some((event) => event.type === "partial-frame")).toBe(true);
  }, 20_000);
});
