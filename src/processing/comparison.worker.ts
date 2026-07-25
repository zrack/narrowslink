/// <reference lib="webworker" />

import {
  compareSources,
  type ComparisonAlignment,
  type ComparisonModel,
  type ComparisonSource,
} from "../domain/comparison";
import type { ComparisonProcessingProgress } from "./comparison-processing";

export interface ComparisonWorkerRequest {
  readonly baseline: ComparisonSource;
  readonly candidate: ComparisonSource;
  readonly alignment: ComparisonAlignment;
}

export type ComparisonWorkerResponse =
  | { readonly type: "progress"; readonly progress: ComparisonProcessingProgress }
  | { readonly type: "success"; readonly model: ComparisonModel }
  | { readonly type: "error"; readonly message: string };

const worker = self as DedicatedWorkerGlobalScope;

worker.addEventListener("message", (event: MessageEvent<ComparisonWorkerRequest>) => {
  try {
    const progress: ComparisonWorkerResponse = {
      type: "progress",
      progress: { percent: 12, message: "Aligning bounded evidence" },
    };
    worker.postMessage(progress);
    const model = compareSources(
      event.data.baseline,
      event.data.candidate,
      event.data.alignment,
    );
    const complete: ComparisonWorkerResponse = { type: "success", model };
    worker.postMessage(complete);
  } catch (error) {
    const response: ComparisonWorkerResponse = {
      type: "error",
      message: error instanceof Error ? error.message : "The comparison could not be constructed.",
    };
    worker.postMessage(response);
  }
}, { once: true });
