import { open, type FileHandle } from "node:fs/promises";

import { EVIDENCE_ARCHIVE_LIMITS } from "../src/domain/evidence-contract";
import {
  EvidenceVerificationError,
  verifyEvidenceBundleBytes,
  type VerifiedEvidenceBundle,
} from "./evidence-verifier";

function fail(message: string, bundlePath: string, cause?: unknown): never {
  throw new EvidenceVerificationError(
    "ARCHIVE_IO_ERROR",
    message,
    bundlePath,
    cause === undefined ? undefined : { cause },
  );
}

export async function verifyEvidenceBundleFile(bundlePath: string): Promise<VerifiedEvidenceBundle> {
  let handle: FileHandle;
  try {
    handle = await open(bundlePath, "r");
  } catch (error) {
    fail(`Cannot open evidence bundle: ${bundlePath}.`, bundlePath, error);
  }
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) fail(`Evidence bundle is not a regular file: ${bundlePath}.`, bundlePath);
    if (fileStat.size > EVIDENCE_ARCHIVE_LIMITS.archiveBytes) {
      throw new EvidenceVerificationError(
        "ARCHIVE_LIMIT_EXCEEDED",
        `Evidence bundle exceeds the ${EVIDENCE_ARCHIVE_LIMITS.archiveBytes}-byte input limit.`,
        bundlePath,
      );
    }
    const buffer = new Uint8Array(fileStat.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.byteLength) {
      const result = await handle.read(buffer, bytesRead, buffer.byteLength - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    if (bytesRead > EVIDENCE_ARCHIVE_LIMITS.archiveBytes) {
      throw new EvidenceVerificationError(
        "ARCHIVE_LIMIT_EXCEEDED",
        `Evidence bundle exceeds the ${EVIDENCE_ARCHIVE_LIMITS.archiveBytes}-byte input limit.`,
        bundlePath,
      );
    }
    const finalStat = await handle.stat();
    if (bytesRead !== fileStat.size || finalStat.size !== fileStat.size) {
      fail(`Evidence bundle changed while it was being read: ${bundlePath}.`, bundlePath);
    }
    return verifyEvidenceBundleBytes(buffer.subarray(0, bytesRead));
  } catch (error) {
    if (error instanceof EvidenceVerificationError) throw error;
    fail(`Cannot read evidence bundle: ${bundlePath}.`, bundlePath, error);
  } finally {
    await handle.close().catch(() => undefined);
  }
}
