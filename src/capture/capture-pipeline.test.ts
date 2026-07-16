import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildEvidenceBundle, type EvidenceBundleManifest } from "../domain/bundle";
import { bytesToHex, encodeFrame, hexToBytes } from "../domain/decoder";
import { parseSession } from "../domain/session";
import type { SourceRecord } from "../domain/types";
import { CaptureRecorder } from "./recorder";

function heartbeatPayload(uptime: number, mode: number, revision: number): Uint8Array {
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  view.setUint32(0, uptime, true);
  view.setUint8(4, mode);
  view.setUint8(5, 0x05);
  view.setUint16(6, revision, true);
  return payload;
}

function decodeText(archive: Record<string, Uint8Array>, path: string): string {
  const bytes = archive[path];
  if (!bytes) throw new Error(`Missing ${path}`);
  return strFromU8(bytes);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("live capture pipeline", () => {
  it("records, round-trips, decodes, and exports exact verifiable capture bytes", async () => {
    const capturedFrames = [
      encodeFrame({
        familyId: 0x02,
        sequence: 301,
        deviceTimeMs: 50,
        payload: heartbeatPayload(3_600, 2, 137),
      }),
      encodeFrame({
        familyId: 0x02,
        sequence: 302,
        deviceTimeMs: 75,
        payload: heartbeatPayload(3_601, 2, 137),
      }),
      encodeFrame({
        familyId: 0x02,
        sequence: 303,
        deviceTimeMs: 100,
        payload: heartbeatPayload(3_602, 3, 137),
      }),
    ];
    const offsetsUs = [0, 25_000, 50_000];
    const recorder = new CaptureRecorder({
      sessionId: "capture-integration-001",
      title: "UDP capture integration",
      startedAt: "2026-07-15T18:00:00.000Z",
      displayTimeZone: "America/Los_Angeles",
      source: {
        id: "udp-loopback-9104",
        kind: "udp",
        label: "UDP 127.0.0.1:9104",
        address: "127.0.0.1",
        port: 9104,
      },
    });

    for (const [index, bytes] of capturedFrames.entries()) {
      recorder.append({ offsetUs: offsetsUs[index] ?? 0, bytes, kernelDropCounter: 0 });
    }

    const finalizedDocument = recorder.finalize(75_000);
    const roundTrippedDocument: unknown = JSON.parse(JSON.stringify(finalizedDocument));
    const session = parseSession(roundTrippedDocument);

    expect(session.document.records).toHaveLength(capturedFrames.length);
    expect(session.frames.map((frame) => frame.status)).toEqual(["complete", "complete", "complete"]);
    expect(session.frames.map((frame) => frame.integrity.status)).toEqual(["valid", "valid", "valid"]);
    expect(session.frames.map((frame) => frame.sequence)).toEqual([301, 302, 303]);
    expect(session.frames.map((frame) => frame.fields.find((field) => field.name === "mode")?.value)).toEqual([
      "Nominal",
      "Nominal",
      "Safe",
    ]);

    const capturedInterval = session.incidents[0];
    expect(capturedInterval).toMatchObject({
      id: "capture-interval",
      startUs: 0,
      endUs: 75_000,
    });
    if (!capturedInterval) throw new Error("Expected CaptureRecorder to create a captured interval");

    const bundleBytes = await buildEvidenceBundle({
      session,
      range: capturedInterval,
      generatedAt: "2026-07-15T18:01:00.000Z",
    });
    const archive = unzipSync(bundleBytes);
    const rawRecords = decodeText(archive, "raw/source-records.ndjson")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as SourceRecord);

    expect(rawRecords.map((record) => record.dataHex)).toEqual(capturedFrames.map(bytesToHex));
    for (const [index, record] of rawRecords.entries()) {
      expect(hexToBytes(record.dataHex)).toEqual(capturedFrames[index]);
      expect(record.captureBytes).toBe(capturedFrames[index]?.byteLength);
    }

    const manifest = JSON.parse(decodeText(archive, "manifest.json")) as EvidenceBundleManifest;
    const checksumLines = new Map(
      decodeText(archive, "SHA256SUMS")
        .trim()
        .split("\n")
        .map((line) => {
          const [hash, path] = line.split("  ");
          return [path, hash];
        }),
    );

    expect(manifest.artifacts.find((artifact) => artifact.path === "raw/source-records.ndjson")).toMatchObject({
      recordCount: capturedFrames.length,
      sha256: await sha256(archive["raw/source-records.ndjson"] ?? new Uint8Array()),
    });
    for (const path of manifest.checksums.covers) {
      const artifact = archive[path];
      expect(artifact, path).toBeDefined();
      if (artifact) expect(checksumLines.get(path)).toBe(await sha256(artifact));
    }
  });
});
