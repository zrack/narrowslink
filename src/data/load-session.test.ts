import { afterEach, describe, expect, it, vi } from "vitest";

import { loadBundledSession, MAX_SESSION_FILE_BYTES } from "./load-session";

describe("bundled session loading", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects malformed UTF-8 instead of replacing evidence bytes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0xff]))));

    await expect(loadBundledSession()).rejects.toThrow("The replay is not valid UTF-8 text.");
  });

  it("enforces the decoded body limit when Content-Length is absent", async () => {
    const oversized = new Uint8Array(MAX_SESSION_FILE_BYTES + 1);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(oversized)));

    await expect(loadBundledSession()).rejects.toThrow("exceeds the 64 MiB safety limit");
  });
});
