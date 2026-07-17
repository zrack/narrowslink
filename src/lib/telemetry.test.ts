import { describe, expect, it } from "vitest";

import type { IncidentProjection, ParsedSession } from "../domain/types";
import { incidentViewRange } from "./telemetry";

function sessionWithDuration(durationUs: number): ParsedSession {
  return { document: { durationUs } } as ParsedSession;
}

function incident(startUs: number, endUs: number): IncidentProjection {
  return { startUs, endUs } as IncidentProjection;
}

describe("incidentViewRange", () => {
  it("keeps the contextual view on integer microsecond boundaries for odd incident durations", () => {
    const selected = incident(500_000_001, 530_000_002);
    const view = incidentViewRange(sessionWithDuration(2_000_000_000), selected);

    expect(Number.isSafeInteger(view.startUs)).toBe(true);
    expect(Number.isSafeInteger(view.endUs)).toBe(true);
    expect(view.startUs).toBeLessThanOrEqual(selected.startUs);
    expect(view.endUs).toBeGreaterThanOrEqual(selected.endUs);
  });

  it("keeps an integer context window inside the session near its end", () => {
    const selected = incident(980_000_000, 999_999_999);
    const view = incidentViewRange(sessionWithDuration(1_000_000_000), selected);

    expect(view).toEqual({ startUs: 550_000_000, endUs: 1_000_000_000 });
  });
});
