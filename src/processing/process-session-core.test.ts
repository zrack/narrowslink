import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sha256Hex } from "../domain/canonical";
import { validateSessionDocument } from "../domain/session";
import type { SessionDocument } from "../domain/types";
import { serializeSessionDocument } from "../data/session-file";
import type { SessionProcessingProgress } from "./contracts";
import {
  processSessionBlobCore,
  SessionProcessingCoreError,
} from "./process-session-core";

function compactFixture(): SessionDocument {
  const fixtureUrl = new URL("../../public/fixtures/harbor-relay-session.json", import.meta.url);
  const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as SessionDocument;
  const records = fixture.records.slice(0, 6);
  const durationUs = (records.at(-1)?.offsetUs ?? 0) + 1;
  return {
    ...fixture,
    id: "session-processing-contract",
    title: "Session processing contract",
    durationUs,
    records,
    incidents: [{
      id: "complete-contract-range",
      title: "Complete contract range",
      startUs: 0,
      endUs: durationUs,
      severity: "info",
    }],
  };
}

describe("worker session-processing core", () => {
  it("produces a deterministic canonical identity and ordered progress contract", async () => {
    const document = compactFixture();
    const normalizedDocument = validateSessionDocument(document);
    const canonical = serializeSessionDocument(normalizedDocument);
    const progress: SessionProcessingProgress[] = [];

    const first = await processSessionBlobCore(
      new Blob([canonical], { type: "application/json" }),
      {
        sourceLabel: "canonical-contract.nlsession",
        onProgress(value) {
          progress.push(value);
        },
      },
    );
    const second = await processSessionBlobCore(
      new Blob([canonical], { type: "application/json" }),
      { sourceLabel: "canonical-contract.nlsession" },
    );

    expect(first.session.document).toEqual(normalizedDocument);
    expect(first.session.frames).toHaveLength(document.records.length);
    expect(first.artifact.sourceWasCanonical).toBe(true);
    expect(first.artifact.byteLength).toBe(new TextEncoder().encode(canonical).byteLength);
    expect(first.artifact.identity).toBe(
      `sha256:${sha256Hex(new TextEncoder().encode(canonical))}`,
    );
    expect(second.artifact.identity).toBe(first.artifact.identity);
    expect(second.session.frames).toEqual(first.session.frames);
    expect(await first.artifact.blob.text()).toBe(canonical);
    expect(first.report).toEqual(expect.objectContaining({
      sourceBytes: first.artifact.byteLength,
      canonicalBytes: first.artifact.byteLength,
      recordCount: document.records.length,
      sourceWasCanonical: true,
    }));

    const phases = progress.map((value) => value.phase);
    expect(phases).toContain("reading");
    expect(phases).toContain("parsing");
    expect(phases).toContain("validating");
    expect(phases).toContain("decoding");
    expect(phases).toContain("aggregating");
    expect(phases.at(-1)).toBe("canonicalizing");
    expect(progress.at(-1)?.percent).toBe(90);
    expect(progress.every((value) => (
      Number.isFinite(value.percent)
      && value.percent >= 0
      && value.percent <= 100
    ))).toBe(true);
  });

  it("canonicalizes valid noncanonical JSON before assigning identity", async () => {
    const document = compactFixture();
    const normalizedDocument = validateSessionDocument(document);
    const source = JSON.stringify(document, null, 2);
    const result = await processSessionBlobCore(
      new Blob([source], { type: "application/json" }),
      { sourceLabel: "pretty-contract.json" },
    );

    expect(result.artifact.sourceWasCanonical).toBe(false);
    expect(await result.artifact.blob.text()).toBe(
      serializeSessionDocument(normalizedDocument),
    );
    expect(result.report.sourceBytes).toBe(new TextEncoder().encode(source).byteLength);
    expect(result.report.canonicalBytes).toBe(result.artifact.byteLength);
  });

  it("rejects malformed UTF-8 and malformed JSON with stable failure codes", async () => {
    await expect(
      processSessionBlobCore(
        new Blob([new Uint8Array([0xff])]),
        { sourceLabel: "invalid-utf8.nlsession" },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_UTF8",
    } satisfies Partial<SessionProcessingCoreError>);

    await expect(
      processSessionBlobCore(
        new Blob(["{"]),
        { sourceLabel: "invalid-json.nlsession" },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_JSON",
    } satisfies Partial<SessionProcessingCoreError>);
  });
});
