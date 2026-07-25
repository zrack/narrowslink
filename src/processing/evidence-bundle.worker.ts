/// <reference lib="webworker" />

import {
  buildEvidenceBundle,
  type BuildEvidenceBundleOptions,
} from "../domain/bundle";
import { processSessionBlobCore } from "./process-session-core";
import type { EvidenceBundleProcessingProgress } from "./evidence-bundle-processing";

export interface EvidenceBundleWorkerRequest {
  readonly sessionBlob: Blob;
  readonly sessionIdentity: string | null;
  readonly options: Omit<BuildEvidenceBundleOptions, "session">;
}

export type EvidenceBundleWorkerResponse =
  | {
      readonly type: "progress";
      readonly progress: EvidenceBundleProcessingProgress;
    }
  | {
      readonly type: "success";
      readonly bytes: ArrayBuffer;
    }
  | {
      readonly type: "error";
      readonly message: string;
    };

const worker = self as DedicatedWorkerGlobalScope;

function postProgress(progress: EvidenceBundleProcessingProgress): void {
  const response: EvidenceBundleWorkerResponse = { type: "progress", progress };
  worker.postMessage(response);
}

worker.addEventListener("message", (event: MessageEvent<EvidenceBundleWorkerRequest>) => {
  void processSessionBlobCore(event.data.sessionBlob, {
    sourceLabel: "canonical session evidence",
    onProgress(progress) {
      postProgress({
        phase: "loading-session",
        percent: progress.percent * 0.68,
        message: `Preparing immutable session evidence: ${progress.message.toLowerCase()}`,
      });
    },
  }).then(async (processed) => {
    if (
      event.data.sessionIdentity !== null
      && processed.session.canonicalIdentity !== event.data.sessionIdentity
    ) {
      throw new Error("The session evidence identity changed before bundle construction.");
    }
    postProgress({
      phase: "selecting-evidence",
      percent: 72,
      message: "Selecting the exact half-open incident range",
    });
    postProgress({
      phase: "hashing-and-compressing",
      percent: 78,
      message: "Hashing artifacts and compressing the archive",
    });
    const bytes = await buildEvidenceBundle({
      ...event.data.options,
      session: processed.session,
    });
    const output = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    postProgress({
      phase: "hashing-and-compressing",
      percent: 100,
      message: "Evidence archive complete",
    });
    const response: EvidenceBundleWorkerResponse = { type: "success", bytes: output };
    worker.postMessage(response, [output]);
  }).catch((error: unknown) => {
    const response: EvidenceBundleWorkerResponse = {
      type: "error",
      message: error instanceof Error ? error.message : "The evidence archive could not be built.",
    };
    worker.postMessage(response);
  });
}, { once: true });
