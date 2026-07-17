import { describe, expect, it } from "vitest";

import type { AuthoredIncidentRange, Marker } from "../domain/types";
import {
  clearSessionWorkspace,
  loadAuthoredIncidentRanges,
  loadMarkers,
  loadSessionNotes,
  loadSessionWorkspace,
  saveAuthoredIncidentRanges,
  saveMarkers,
  saveSessionNotes,
  saveSessionWorkspace,
  type SessionWorkspaceContext,
  type StorageLike,
} from "./session-storage";

interface MemoryStorage extends StorageLike {
  values: Map<string, string>;
  writes: string[];
  removals: string[];
}

function memoryStorage(): MemoryStorage {
  const values = new Map<string, string>();
  const writes: string[] = [];
  const removals: string[] = [];
  return {
    values,
    writes,
    removals,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key);
      values.set(key, value);
    },
    removeItem: (key) => {
      removals.push(key);
      values.delete(key);
    },
  };
}

const identity = "session:content";
const createdAt = "2026-07-16T12:00:00.000Z";
const updatedAt = "2026-07-16T12:05:00.000Z";
const context: SessionWorkspaceContext = {
  durationUs: 10_000,
  reservedIncidentIds: ["imported-range"],
};

function storageKey(version: 1 | 2, sessionId = identity): string {
  const normalized = sessionId.trim();
  const encoded = Array.from(
    { length: normalized.length },
    (_, index) => normalized.charCodeAt(index).toString(16).padStart(4, "0"),
  ).join("");
  return `narrowslink:session-workspace:v${version}:${encoded}`;
}

function marker(id = "marker-1", offsetUs = 500): Marker {
  return {
    id,
    offsetUs,
    title: `Marker ${id}`,
    note: "Operator context",
    category: "observation",
    createdAt,
  };
}

function range(
  id = "operator-range-1",
  overrides: Partial<AuthoredIncidentRange> = {},
): AuthoredIncidentRange {
  return {
    id,
    title: `Range ${id}`,
    startUs: 1_000,
    endUs: 2_000,
    severity: "info",
    createdAt,
    updatedAt,
    ...overrides,
  };
}

function persistedV1(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    markers: [marker()],
    notes: "Legacy note",
    updatedAt,
    ...overrides,
  });
}

function persistedV2(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 2,
    markers: [],
    notes: "",
    authoredIncidentRanges: [],
    updatedAt,
    ...overrides,
  });
}

describe("session workspace storage", () => {
  it("round-trips version 2 markers, notes, and operator-authored ranges", () => {
    const storage = memoryStorage();
    const workspace = {
      markers: [marker()],
      notes: "Retained note",
      authoredIncidentRanges: [range()],
    };

    expect(saveSessionWorkspace(identity, workspace, context, storage)).toBe(true);
    expect(JSON.parse(storage.values.get(storageKey(2)) ?? "null")).toMatchObject({
      version: 2,
      ...workspace,
    });
    expect(loadSessionWorkspace(identity, context, storage)).toMatchObject(workspace);
    expect(loadSessionWorkspace(identity, context, storage).updatedAt).toEqual(expect.any(String));
  });

  it("keeps storage keys stable for identifiers containing lone UTF-16 surrogates", () => {
    const storage = memoryStorage();
    const surrogateIdentity = `session-\ud800:content`;

    expect(saveSessionWorkspace(
      surrogateIdentity,
      { markers: [], notes: "retained", authoredIncidentRanges: [] },
      context,
      storage,
    )).toBe(true);
    expect(storage.values.has(storageKey(2, surrogateIdentity))).toBe(true);
    expect(loadSessionWorkspace(surrogateIdentity, context, storage)).toMatchObject({
      notes: "retained",
      markers: [],
      authoredIncidentRanges: [],
    });
  });

  it("loads version 1 data and lazily migrates it on the next successful save", () => {
    const storage = memoryStorage();
    storage.values.set(storageKey(1), persistedV1());

    const loaded = loadSessionWorkspace(identity, context, storage);
    expect(loaded).toEqual({
      markers: [marker()],
      notes: "Legacy note",
      authoredIncidentRanges: [],
      updatedAt,
    });
    expect(storage.values.has(storageKey(2))).toBe(false);

    expect(saveSessionWorkspace(identity, loaded, context, storage)).toBe(true);
    expect(storage.values.has(storageKey(1))).toBe(false);
    expect(JSON.parse(storage.values.get(storageKey(2)) ?? "null")).toMatchObject({
      version: 2,
      markers: [marker()],
      notes: "Legacy note",
      authoredIncidentRanges: [],
    });
  });

  it("falls back to valid version 1 data when version 2 is corrupt", () => {
    const storage = memoryStorage();
    storage.values.set(storageKey(2), "{");
    storage.values.set(storageKey(1), persistedV1({ notes: "Recovered" }));

    expect(loadSessionWorkspace(identity, context, storage)).toMatchObject({
      notes: "Recovered",
      authoredIncidentRanges: [],
    });
  });

  it("does not resurrect version 1 data when a valid empty version 2 workspace exists", () => {
    const storage = memoryStorage();
    storage.values.set(storageKey(2), persistedV2());
    storage.values.set(storageKey(1), persistedV1({ notes: "Deleted legacy state" }));

    expect(loadSessionWorkspace(identity, context, storage)).toEqual({
      markers: [],
      notes: "",
      authoredIncidentRanges: [],
      updatedAt,
    });
  });

  it("keeps legacy state when the version 2 write fails", () => {
    const storage = memoryStorage();
    storage.values.set(storageKey(1), persistedV1());
    storage.setItem = (key, value) => {
      if (key === storageKey(2)) throw new Error("quota exceeded");
      storage.values.set(key, value);
    };

    expect(saveSessionWorkspace(
      identity,
      { markers: [], notes: "new", authoredIncidentRanges: [] },
      context,
      storage,
    )).toBe(false);
    expect(storage.values.has(storageKey(1))).toBe(true);
    expect(storage.values.has(storageKey(2))).toBe(false);
  });

  it("treats legacy cleanup failure as non-fatal after version 2 is durable", () => {
    const storage = memoryStorage();
    storage.values.set(storageKey(1), persistedV1());
    storage.removeItem = (key) => {
      if (key === storageKey(1)) throw new Error("cleanup denied");
      storage.values.delete(key);
    };

    expect(saveSessionWorkspace(
      identity,
      { markers: [], notes: "new", authoredIncidentRanges: [] },
      context,
      storage,
    )).toBe(true);
    expect(storage.values.has(storageKey(2))).toBe(true);
    expect(storage.values.has(storageKey(1))).toBe(true);
  });

  it("salvages valid entries from a partially corrupt version 2 workspace", () => {
    const storage = memoryStorage();
    const validFirst = range("valid-first");
    const validSecond = range("valid-second", { startUs: 8_000, endUs: 10_000 });
    storage.values.set(storageKey(2), persistedV2({
      markers: [marker("valid-marker"), marker("outside", context.durationUs), { ...marker("bad-date"), createdAt: "never" }],
      notes: "n".repeat(20_005),
      authoredIncidentRanges: [
        validFirst,
        { ...validFirst, title: "Duplicate ID" },
        range("imported-range"),
        range("fractional", { startUs: 1_000.5 }),
        range("empty", { startUs: 2_000, endUs: 2_000 }),
        range("beyond", { endUs: context.durationUs + 1 }),
        { ...range("bad-severity"), severity: "urgent" },
        { ...range("bad-timestamp"), updatedAt: "never" },
        range("blank-title", { title: "   " }),
        range("bad-unicode", { title: "Bad \ud800 title" }),
        validSecond,
      ],
    }));

    const loaded = loadSessionWorkspace(identity, context, storage);
    expect(loaded.markers.map((item) => item.id)).toEqual(["valid-marker"]);
    expect(loaded.notes).toHaveLength(20_000);
    expect(loaded.authoredIncidentRanges).toEqual([validFirst, validSecond]);
  });

  it("caps salvaged authored ranges at one hundred", () => {
    const storage = memoryStorage();
    const ranges = Array.from({ length: 105 }, (_, index) => range(`range-${index}`));
    storage.values.set(storageKey(2), persistedV2({ authoredIncidentRanges: ranges }));

    const loaded = loadSessionWorkspace(identity, context, storage);
    expect(loaded.authoredIncidentRanges).toHaveLength(100);
    expect(loaded.authoredIncidentRanges.at(-1)?.id).toBe("range-99");
  });

  it("accepts overlapping half-open ranges and exactly one hundred authored ranges", () => {
    const storage = memoryStorage();
    const ranges = Array.from({ length: 100 }, (_, index) => range(`range-${index}`, {
      startUs: 100,
      endUs: 9_900,
    }));

    expect(saveSessionWorkspace(
      identity,
      { markers: [], notes: "", authoredIncidentRanges: ranges },
      context,
      storage,
    )).toBe(true);
    expect(loadSessionWorkspace(identity, context, storage).authoredIncidentRanges).toHaveLength(100);
  });

  it("rejects invalid authored ranges, duplicate IDs, reserved IDs, and over-limit arrays on save", () => {
    const storage = memoryStorage();
    const invalidRanges = [
      range("negative", { startUs: -1 }),
      range("fractional", { startUs: 1.5 }),
      range("empty", { startUs: 100, endUs: 100 }),
      range("beyond", { endUs: context.durationUs + 1 }),
      range("blank", { title: " " }),
      range("long-id", { id: "i".repeat(129) }),
      range("long-title", { title: "t".repeat(241) }),
      range("bad-created", { createdAt: "invalid" }),
      range("backward-time", { createdAt: updatedAt, updatedAt: createdAt }),
      { ...range("bad-severity"), severity: "urgent" } as unknown as AuthoredIncidentRange,
    ];

    for (const invalidRange of invalidRanges) {
      expect(saveSessionWorkspace(
        identity,
        { markers: [], notes: "", authoredIncidentRanges: [invalidRange] },
        context,
        storage,
      )).toBe(false);
    }
    expect(saveSessionWorkspace(
      identity,
      { markers: [], notes: "", authoredIncidentRanges: [range("duplicate"), range("duplicate")] },
      context,
      storage,
    )).toBe(false);
    expect(saveSessionWorkspace(
      identity,
      { markers: [], notes: "", authoredIncidentRanges: [range("imported-range")] },
      context,
      storage,
    )).toBe(false);
    expect(saveSessionWorkspace(
      identity,
      {
        markers: [],
        notes: "",
        authoredIncidentRanges: Array.from({ length: 101 }, (_, index) => range(`too-many-${index}`)),
      },
      context,
      storage,
    )).toBe(false);
  });

  it("rejects out-of-session markers and invalid workspace contexts on save", () => {
    const storage = memoryStorage();
    expect(saveSessionWorkspace(
      identity,
      { markers: [marker("outside", context.durationUs)], notes: "", authoredIncidentRanges: [] },
      context,
      storage,
    )).toBe(false);
    expect(saveSessionWorkspace(
      identity,
      { markers: [], notes: "", authoredIncidentRanges: [] },
      { ...context, durationUs: 0 },
      storage,
    )).toBe(false);
  });

  it("preserves all other workspace fields through convenience helper saves", () => {
    const storage = memoryStorage();
    expect(saveSessionWorkspace(
      identity,
      { markers: [marker()], notes: "original", authoredIncidentRanges: [range()] },
      context,
      storage,
    )).toBe(true);

    expect(saveMarkers(identity, [marker("marker-2", 750)], context, storage)).toBe(true);
    expect(loadSessionNotes(identity, context, storage)).toBe("original");
    expect(loadAuthoredIncidentRanges(identity, context, storage)).toEqual([range()]);

    expect(saveSessionNotes(identity, "changed", context, storage)).toBe(true);
    expect(loadMarkers(identity, context, storage)).toEqual([marker("marker-2", 750)]);
    expect(loadAuthoredIncidentRanges(identity, context, storage)).toEqual([range()]);

    const replacement = [range("operator-range-2", { startUs: 3_000, endUs: 4_000 })];
    expect(saveAuthoredIncidentRanges(identity, replacement, context, storage)).toBe(true);
    expect(loadSessionWorkspace(identity, context, storage)).toMatchObject({
      markers: [marker("marker-2", 750)],
      notes: "changed",
      authoredIncidentRanges: replacement,
    });
  });

  it("does not mutate workspace inputs while serializing", () => {
    const storage = memoryStorage();
    const workspace = {
      markers: [marker()],
      notes: "immutable",
      authoredIncidentRanges: [range()],
    };
    const before = JSON.stringify(workspace);

    expect(saveSessionWorkspace(identity, workspace, context, storage)).toBe(true);
    expect(JSON.stringify(workspace)).toBe(before);
    const loaded = loadSessionWorkspace(identity, context, storage);
    expect(loaded.markers).not.toBe(workspace.markers);
    expect(loaded.authoredIncidentRanges).not.toBe(workspace.authoredIncidentRanges);
  });

  it("clears both current and legacy workspace keys", () => {
    const storage = memoryStorage();
    storage.values.set(storageKey(1), persistedV1());
    storage.values.set(storageKey(2), persistedV2());

    expect(clearSessionWorkspace(identity, storage)).toBe(true);
    expect(storage.values.has(storageKey(1))).toBe(false);
    expect(storage.values.has(storageKey(2))).toBe(false);
    expect(storage.removals).toEqual([storageKey(2), storageKey(1)]);
  });

  it("handles unavailable or throwing storage without escaping errors", () => {
    const throwingStorage: StorageLike = {
      getItem: () => { throw new Error("read denied"); },
      setItem: () => { throw new Error("write denied"); },
      removeItem: () => { throw new Error("remove denied"); },
    };

    expect(loadSessionWorkspace(identity, context, throwingStorage)).toEqual({
      markers: [],
      notes: "",
      authoredIncidentRanges: [],
      updatedAt: null,
    });
    expect(saveSessionWorkspace(
      identity,
      { markers: [], notes: "", authoredIncidentRanges: [] },
      context,
      throwingStorage,
    )).toBe(false);
    expect(clearSessionWorkspace(identity, throwingStorage)).toBe(false);
    expect(loadSessionWorkspace(identity, context, null)).toEqual({
      markers: [],
      notes: "",
      authoredIncidentRanges: [],
      updatedAt: null,
    });
  });
});
