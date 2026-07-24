import { describe, expect, it, vi } from "vitest";
import {
  loadOperatorRuntime,
  MANUAL_OPERATOR_RUNTIME,
  OPERATOR_RUNTIME_PATH,
} from "./operator-runtime";

function response(body: unknown, init?: ResponseInit): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), init);
}

describe("operator runtime discovery", () => {
  it("accepts a bounded managed runtime without exposing an authentication secret", async () => {
    const fetchImpl = vi.fn(async () => response({
      format: "narrowslink/operator-runtime",
      formatVersion: 1,
      mode: "managed",
      bridge: {
        baseUrl: "http://127.0.0.1:49123",
        authentication: "same-origin-proxy",
      },
      release: {
        version: "0.1.0",
        commit: "0123456789abcdef0123456789abcdef01234567",
      },
      defaults: {
        host: "127.0.0.1",
        port: 0,
        multicastGroup: null,
        multicastInterface: null,
      },
    }, { headers: { "Content-Type": "application/json; charset=utf-8" } }));

    await expect(loadOperatorRuntime(fetchImpl as typeof fetch)).resolves.toEqual({
      mode: "managed",
      format: "narrowslink/operator-runtime",
      formatVersion: 1,
      controlUrl: "http://127.0.0.1:49123",
      version: "0.1.0",
      commit: "0123456789abcdef0123456789abcdef01234567",
      defaults: {
        host: "127.0.0.1",
        port: 0,
        multicastGroup: null,
        multicastInterface: null,
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(OPERATOR_RUNTIME_PATH, expect.objectContaining({
      credentials: "same-origin",
      cache: "no-store",
    }));
  });

  it("uses manual bridge configuration when the development server returns its HTML fallback", async () => {
    const fetchImpl = vi.fn(async () => response("<!doctype html>", {
      headers: { "Content-Type": "text/html" },
    }));
    await expect(loadOperatorRuntime(fetchImpl as typeof fetch)).resolves.toBe(MANUAL_OPERATOR_RUNTIME);
  });

  it("accepts the explicit manual descriptor shipped for source preview", async () => {
    const fetchImpl = vi.fn(async () => response({
      format: "narrowslink/operator-runtime",
      formatVersion: 1,
      mode: "manual",
    }, { headers: { "Content-Type": "application/json" } }));
    await expect(loadOperatorRuntime(fetchImpl as typeof fetch)).resolves.toBe(MANUAL_OPERATOR_RUNTIME);
  });

  it("blocks a malformed managed response instead of silently downgrading authentication", async () => {
    const fetchImpl = vi.fn(async () => response({
      format: "narrowslink/operator-runtime",
      formatVersion: 1,
      mode: "managed",
      bridge: { baseUrl: "https://example.com", authentication: "same-origin-proxy" },
      release: { version: "0.1.0", commit: "unknown" },
      defaults: { host: "127.0.0.1", port: 0, multicastGroup: null, multicastInterface: null },
    }, { headers: { "Content-Type": "application/json" } }));

    await expect(loadOperatorRuntime(fetchImpl as typeof fetch)).resolves.toMatchObject({
      mode: "invalid",
      message: expect.stringContaining("invalid"),
    });
  });
});
