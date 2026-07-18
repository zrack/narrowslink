import { describe, expect, it } from "vitest";

import type { SessionLibraryEntry } from "./session-library";
import { createOperationGate, resolveCommittedSave } from "./session-library-workflow";

function entry(seed: string, savedAt: string): SessionLibraryEntry {
  return {
    identity: `sha256:${seed.repeat(64)}`,
    sessionId: `session-${seed}`,
    title: `Session ${seed.toUpperCase()}`,
    startedAt: "2026-07-16T04:38:12.000Z",
    displayTimeZone: "UTC",
    durationUs: 1_000_000,
    formatVersion: 1,
    sourceKind: "file",
    sourceLabel: `${seed}.nlsession`,
    decoderId: "NSL-01",
    decoderRevision: "1.3.7",
    decoderSchemaHash: "sha256:test-schema",
    captureIntegrityStatus: "unknown",
    recordCount: 1,
    byteLength: 256,
    savedAt,
  };
}

describe("session-library operation gate", () => {
  it("lets only the newest asynchronous operation completion update state", () => {
    const gate = createOperationGate();
    const first = gate.begin();
    expect(gate.isCurrent(first)).toBe(true);

    const second = gate.begin();

    expect(second).toBeGreaterThan(first);
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    expect(gate.isCurrent(Number.NaN)).toBe(false);
  });
});

describe("committed session save resolution", () => {
  it("uses the authoritative refreshed ordering after a successful list refresh", () => {
    const current = entry("a", "2026-07-17T12:00:00.000Z");
    const committed = entry("b", "2026-07-17T12:05:00.000Z");
    const refreshed = [committed, current];

    const result = resolveCommittedSave([current], committed, { ok: true, entries: refreshed });

    expect(result).toEqual({ entries: refreshed, warning: null });
    expect(result.entries).not.toBe(refreshed);
  });

  it("keeps a committed save newest-first and surfaces the refresh warning", () => {
    const older = entry("a", "2026-07-17T12:00:00.000Z");
    const committed = entry("b", "2026-07-17T12:05:00.000Z");
    const warning = "The session was saved, but the local library list could not be refreshed.";

    expect(resolveCommittedSave([older], committed, { ok: false, warning })).toEqual({
      entries: [committed, older],
      warning,
    });
  });

  it("replaces stale metadata for the committed identity without duplicating it", () => {
    const staleCommitted = entry("b", "2026-07-17T11:55:00.000Z");
    const older = entry("a", "2026-07-17T12:00:00.000Z");
    const committed = entry("b", "2026-07-17T12:05:00.000Z");

    const result = resolveCommittedSave(
      [older, staleCommitted],
      committed,
      { ok: false, warning: "Refresh failed" },
    );

    expect(result.entries).toEqual([committed, older]);
    expect(result.entries.filter((candidate) => candidate.identity === committed.identity)).toHaveLength(1);
  });

  it("keeps an exact duplicate at its original saved-time position when refresh fails", () => {
    const newest = entry("c", "2026-07-17T12:10:00.000Z");
    const originalDuplicate = entry("b", "2026-07-17T12:00:00.000Z");
    const oldest = entry("a", "2026-07-17T11:50:00.000Z");
    const committedDuplicate = { ...originalDuplicate, title: "Canonical duplicate metadata" };

    const result = resolveCommittedSave(
      [newest, originalDuplicate, oldest],
      committedDuplicate,
      { ok: false, warning: "Refresh failed" },
    );

    expect(result.entries).toEqual([newest, committedDuplicate, oldest]);
  });

  it("uses identity as a deterministic tie-break for equal save times", () => {
    const alpha = entry("a", "2026-07-17T12:00:00.000Z");
    const bravo = entry("b", "2026-07-17T12:00:00.000Z");

    const result = resolveCommittedSave(
      [bravo],
      alpha,
      { ok: false, warning: "Refresh failed" },
    );

    expect(result.entries).toEqual([bravo, alpha]);
  });
});
