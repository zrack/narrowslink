import { describe, expect, it, vi } from "vitest";

import { EVIDENCE_ARCHIVE_LIMITS } from "../domain/evidence-contract";
import {
  EvidenceBundleLoadError,
  loadEvidenceBundleFile,
} from "./load-evidence-bundle";

describe("loadEvidenceBundleFile", () => {
  it("rejects oversized metadata before reading browser file bytes", async () => {
    const arrayBuffer = vi.fn<() => Promise<ArrayBuffer>>();
    const file = {
      name: "oversized.nlb",
      size: EVIDENCE_ARCHIVE_LIMITS.archiveBytes + 1,
      arrayBuffer,
    } as unknown as File;

    await expect(loadEvidenceBundleFile(file, vi.fn())).rejects.toMatchObject({
      code: "ARCHIVE_LIMIT_EXCEEDED",
      path: "oversized.nlb",
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("keeps verifier failures typed for the receiver-open recovery dialog", async () => {
    const file = new File([Uint8Array.of(1, 2, 3)], "unsafe.nlb");
    const error = new EvidenceBundleLoadError(
      "ARCHIVE_UNSAFE",
      "Unsafe archive path.",
      "../escape",
    );

    await expect(loadEvidenceBundleFile(file, async () => {
      throw error;
    })).rejects.toBe(error);
  });
});
