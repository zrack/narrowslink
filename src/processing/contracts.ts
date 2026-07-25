export type SessionProcessingPhase =
  | "reading"
  | "parsing"
  | "validating"
  | "decoding"
  | "aggregating"
  | "canonicalizing"
  | "transferring";

export interface SessionProcessingProgress {
  readonly phase: SessionProcessingPhase;
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
  readonly message: string;
}

export interface SessionProcessingTimings {
  readonly readingMs: number;
  readonly parsingMs: number;
  readonly validatingAndDecodingMs: number;
  readonly canonicalizingMs: number;
  readonly totalMs: number;
}

export interface SessionProcessingReport {
  readonly sourceBytes: number;
  readonly canonicalBytes: number;
  readonly recordCount: number;
  readonly sourceWasCanonical: boolean;
  readonly timings: SessionProcessingTimings;
}

export const SESSION_PROCESSING_PHASE_WEIGHT: Readonly<Record<SessionProcessingPhase, {
  readonly start: number;
  readonly end: number;
}>> = Object.freeze({
  reading: { start: 0, end: 20 },
  parsing: { start: 20, end: 32 },
  validating: { start: 32, end: 50 },
  decoding: { start: 50, end: 72 },
  aggregating: { start: 72, end: 82 },
  canonicalizing: { start: 82, end: 90 },
  transferring: { start: 90, end: 100 },
});

const PHASE_MESSAGES: Readonly<Record<SessionProcessingPhase, string>> = Object.freeze({
  reading: "Reading bounded source bytes",
  parsing: "Parsing UTF-8 session JSON",
  validating: "Validating immutable records and evidence",
  decoding: "Replaying the identified decoder",
  aggregating: "Building bounded timeline indexes",
  canonicalizing: "Calculating canonical content identity",
  transferring: "Transferring validated evidence in bounded chunks",
});

export function processingProgress(
  phase: SessionProcessingPhase,
  completed: number,
  total: number,
): SessionProcessingProgress {
  const bounds = SESSION_PROCESSING_PHASE_WEIGHT[phase];
  const ratio = total <= 0 ? 0 : Math.min(1, Math.max(0, completed / total));
  return {
    phase,
    completed,
    total,
    percent: bounds.start + (bounds.end - bounds.start) * ratio,
    message: PHASE_MESSAGES[phase],
  };
}
