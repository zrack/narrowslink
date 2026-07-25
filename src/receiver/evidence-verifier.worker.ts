/// <reference lib="webworker" />

import {
  EvidenceVerificationError,
  verifyEvidenceBundleBytes,
} from "../../verifier/evidence-verifier";

export interface ReceiverVerificationWorkerRequest {
  bytes: ArrayBuffer;
}

export type ReceiverVerificationWorkerResponse =
  | {
      ok: true;
      verified: ReturnType<typeof verifyEvidenceBundleBytes>;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        path: string | null;
      };
    };

const worker = self as DedicatedWorkerGlobalScope;

worker.addEventListener("message", (event: MessageEvent<ReceiverVerificationWorkerRequest>) => {
  try {
    const verified = verifyEvidenceBundleBytes(new Uint8Array(event.data.bytes));
    const response: ReceiverVerificationWorkerResponse = { ok: true, verified };
    worker.postMessage(response);
  } catch (error) {
    const response: ReceiverVerificationWorkerResponse = {
      ok: false,
      error: error instanceof EvidenceVerificationError
        ? {
            code: error.code,
            message: error.message,
            path: error.path ?? null,
          }
        : {
            code: "WORKER_FAILURE",
            message: error instanceof Error ? error.message : "Evidence verification failed unexpectedly.",
            path: null,
          },
    };
    worker.postMessage(response);
  }
});

export {};
