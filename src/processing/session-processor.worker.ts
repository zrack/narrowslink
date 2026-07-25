/// <reference lib="webworker" />

import {
  processSessionBlobCore,
  SessionProcessingCoreError,
} from "./process-session-core";
import type {
  DecodedFrame,
  ParsedSession,
  SourceRecord,
} from "../domain/types";
import type {
  CanonicalSessionArtifact,
} from "./session-artifact";
import type { SessionProcessingProgress } from "./contracts";
import type { SessionProcessingReport } from "./contracts";

export interface SessionProcessorWorkerRequest {
  readonly blob: Blob;
  readonly sourceLabel: string;
}

export interface WorkerProcessedSessionResult {
  readonly session: Omit<ParsedSession, "framesById">;
  readonly artifact: CanonicalSessionArtifact;
  readonly report: SessionProcessingReport;
}

export interface WorkerSessionChunk {
  readonly start: number;
  readonly records: SourceRecord[];
  readonly frames: DecodedFrame[];
}

export type SessionProcessorWorkerResponse =
  | { readonly type: "progress"; readonly progress: SessionProcessingProgress }
  | {
      readonly type: "chunk";
      readonly chunk: WorkerSessionChunk;
      readonly completed: number;
      readonly total: number;
    }
  | {
      readonly type: "success";
      readonly result: WorkerProcessedSessionResult;
    }
  | {
      readonly type: "error";
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly details: readonly string[];
      };
    };

const worker = self as DedicatedWorkerGlobalScope;
const RESULT_CHUNK_RECORDS = 2_048;

worker.addEventListener("message", (event: MessageEvent<SessionProcessorWorkerRequest>) => {
  void processSessionBlobCore(event.data.blob, {
    sourceLabel: event.data.sourceLabel,
    onProgress(progress) {
      const response: SessionProcessorWorkerResponse = { type: "progress", progress };
      worker.postMessage(response);
    },
  }).then((result) => {
    const total = result.session.document.records.length;
    for (let start = 0; start < total; start += RESULT_CHUNK_RECORDS) {
      const end = Math.min(total, start + RESULT_CHUNK_RECORDS);
      const chunk: WorkerSessionChunk = {
        start,
        records: result.session.document.records.slice(start, end),
        frames: result.session.frames.slice(start, end),
      };
      const response: SessionProcessorWorkerResponse = {
        type: "chunk",
        chunk,
        completed: end,
        total,
      };
      worker.postMessage(response);
    }
    const {
      framesById: _framesById,
      document,
      ...sessionWithoutDocument
    } = result.session;
    const session: Omit<ParsedSession, "framesById"> = {
      ...sessionWithoutDocument,
      document: {
        ...document,
        records: [],
      },
      frames: [],
    };
    const response: SessionProcessorWorkerResponse = {
      type: "success",
      result: {
        session,
        artifact: result.artifact,
        report: result.report,
      },
    };
    worker.postMessage(response);
  }).catch((error: unknown) => {
    const response: SessionProcessorWorkerResponse = {
      type: "error",
      error: error instanceof SessionProcessingCoreError
        ? {
            code: error.code,
            message: error.message,
            details: error.details,
          }
        : {
            code: "PROCESSING_FAILED",
            message: "The replay processing worker could not complete.",
            details: [error instanceof Error ? error.message : "Unknown worker error."],
          },
    };
    worker.postMessage(response);
  });
}, { once: true });
