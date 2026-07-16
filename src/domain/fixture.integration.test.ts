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

    const fade = session.incidents.find((incident) => incident.id === "fade");
    if (!fade) throw new Error("Expected fade incident");
    const fadeCenterUs = fade.startUs + (fade.endUs - fade.startUs) / 2;
    const centerBuckets = session.buckets.filter(
      (bucket) => bucket.offsetUs >= fadeCenterUs - 15_000_000 && bucket.offsetUs < fadeCenterUs + 15_000_000,
    );
    const shoulderBuckets = session.buckets.filter(
      (bucket) => (
        bucket.offsetUs >= fade.startUs - 60_000_000 && bucket.offsetUs < fade.startUs
      ) || (
        bucket.offsetUs >= fade.endUs && bucket.offsetUs < fade.endUs + 60_000_000
      ),
    );
    const averageThroughput = (buckets: typeof session.buckets) => (
      buckets.reduce((sum, bucket) => sum + bucket.throughput, 0) / buckets.length
    );
    expect(averageThroughput(shoulderBuckets)).toBeGreaterThan(averageThroughput(centerBuckets) * 2.5);
    expect(fade.stats.averageThroughput).toBeGreaterThan(0.9);
    expect(fade.stats.averageThroughput).toBeLessThan(1.5);
    expect(fade.stats.lossPct).toBeGreaterThan(4);
    expect(fade.stats.lossPct).toBeLessThan(8);

    const overviewRates = Array.from({ length: Math.ceil(session.document.durationUs / 20_000_000) }, (_, index) => {
      const startUs = index * 20_000_000;
      const endUs = Math.min(session.document.durationUs, startUs + 20_000_000);
      const recordsInWindow = session.buckets
        .filter((bucket) => bucket.offsetUs >= startUs && bucket.offsetUs < endUs)
        .reduce((sum, bucket) => sum + bucket.received, 0);
      return recordsInWindow / ((endUs - startUs) / 1_000_000);
    }).sort((left, right) => left - right);
    const medianOverviewRate = overviewRates[Math.floor(overviewRates.length / 2)] ?? 0;
    const maximumOverviewRate = overviewRates.at(-1) ?? 0;
    expect(medianOverviewRate).toBeGreaterThan(0);
    expect(maximumOverviewRate).toBeLessThan(medianOverviewRate * 1.75);

    const resync = fade.diagnostics.find((event) => event.type === "decoder-resync");
    const relock = fade.diagnostics.find(
      (event) => event.type === "decoder-locked" && (resync == null || event.startUs > resync.startUs),
    );
    expect(resync).toBeDefined();
    expect(relock).toBeDefined();
    if (!resync || !relock) throw new Error("Expected fade decoder state transitions");
    expect(relock.startUs - resync.startUs).toBeGreaterThan(75_000_000);
    expect(relock.startUs - resync.startUs).toBeLessThan(90_000_000);
  }, 20_000);
});
