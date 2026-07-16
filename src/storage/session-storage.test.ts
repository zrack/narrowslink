import { describe, expect, it } from "vitest";

import { loadSessionWorkspace, saveSessionWorkspace, type StorageLike } from "./session-storage";

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe("session workspace storage", () => {
  it("creates a stable storage key for identifiers containing lone UTF-16 surrogates", () => {
    const storage = memoryStorage();
    const identity = `session-\ud800:content`;

    expect(saveSessionWorkspace(identity, { markers: [], notes: "retained" }, storage)).toBe(true);
    expect(loadSessionWorkspace(identity, storage)).toMatchObject({ notes: "retained", markers: [] });
  });
});
