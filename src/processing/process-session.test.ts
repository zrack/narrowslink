import { describe, expect, it } from "vitest";

import { serializeSessionDocument } from "../data/session-file";
import { parseSession } from "../domain/session";
import type { ParsedSession } from "../domain/types";
import fixture from "../../public/fixtures/harbor-relay-session.json";
import { processSessionBlobCore } from "./process-session-core";
import { hydrateWorkerResult } from "./process-session";

describe("worker session hydration", () => {
  it("restores immutable raw records and source linkage after structured cloning", async () => {
    const document = {
      ...fixture,
      records: fixture.records.slice(0, 2),
      incidents: [],
      durationUs: fixture.records[1]!.offsetUs + 1,
    };
    const processed = await processSessionBlobCore(
      new Blob([serializeSessionDocument(parseSession(document).document)]),
      { sourceLabel: "worker-hydration-test.nlsession" },
    );
    const chunk = structuredClone({
      records: processed.session.document.records,
      frames: processed.session.frames,
    });
    const {
      framesById: _framesById,
      document: processedDocument,
      ...sessionWithoutDocument
    } = structuredClone(processed.session);
    const shell: Omit<ParsedSession, "framesById"> = {
      ...sessionWithoutDocument,
      document: { ...processedDocument, records: [] },
      frames: [],
    };

    const hydrated = hydrateWorkerResult(
      {
        session: shell,
        artifact: processed.artifact,
        report: processed.report,
      },
      chunk.records,
      chunk.frames,
    );

    expect(hydrated.session.frames[0]?.sourceRecord)
      .toBe(hydrated.session.document.records[0]);
    expect(Object.isFrozen(hydrated.session.document)).toBe(true);
    expect(Object.isFrozen(hydrated.session.document.records)).toBe(true);
    expect(Object.isFrozen(hydrated.session.document.records[0])).toBe(true);
    expect(Object.isFrozen(hydrated.session.document.records[0]?.transport)).toBe(true);
  });
});
