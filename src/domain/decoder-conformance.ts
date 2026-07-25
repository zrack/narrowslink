import {
  validateDecoderPackRuntime,
} from "./decoder";
import {
  DecoderPackValidationError,
  decoderDescriptorForPack,
  validateDecoderPack,
  type DecoderPackDocument,
} from "./decoder-pack";
import { parseSession } from "./session";
import type { CaptureIntegrityReceipt, SessionDocumentV2, SourceRecord } from "./types";

export interface DecoderPackConformanceResult {
  pack: DecoderPackDocument;
  fixtureIds: string[];
  frameCount: number;
}

function valuesMatch(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "number" && typeof expected === "number") {
    return Math.abs(actual - expected) <= Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected)) * 8;
  }
  return Object.is(actual, expected);
}

function fixtureSession(
  pack: DecoderPackDocument,
  fixture: DecoderPackDocument["fixtures"][number],
): SessionDocumentV2 {
  const records: SourceRecord[] = fixture.records.map((record, index) => {
    const captureBytes = record.dataHex.length / 2;
    return {
      id: `${fixture.id}-record-${index + 1}`,
      index,
      sourceId: `${fixture.id}-source`,
      offsetUs: record.offsetUs,
      dataHex: record.dataHex.toUpperCase(),
      captureBytes,
      wireBytes: captureBytes,
      transport: { kind: "file" },
    };
  });
  const retainedBytes = records.reduce((total, record) => total + record.captureBytes, 0);
  const captureIntegrity: CaptureIntegrityReceipt = {
    schemaVersion: 1,
    status: "unknown",
    assessmentBasis: "file-source-unassessed",
    stopDisposition: "not-observed",
    stopOffsetUs: null,
    eventLogComplete: false,
    input: {
      unit: "unknown",
      observedUnits: null,
      observedBytes: null,
      transportReportedUnits: null,
      transportReportedBytes: null,
    },
    retained: { records: records.length, bytes: retainedBytes },
    issueCodes: ["file-source-unassessed"],
  };
  return {
    format: "narrowslink/session",
    formatVersion: 2,
    id: `decoder-conformance-${fixture.id}`,
    title: fixture.title,
    startedAt: "2000-01-01T00:00:00.000Z",
    displayTimeZone: "UTC",
    durationUs: Math.max(...records.map((record) => record.offsetUs)) + 1,
    source: {
      id: `${fixture.id}-source`,
      kind: "file",
      label: `${pack.displayName} conformance fixture`,
    },
    decoder: decoderDescriptorForPack(pack),
    decoderPack: pack,
    records,
    incidents: [],
    transportEvents: [],
    captureIntegrity,
  };
}

export function verifyDecoderPackConformance(input: unknown): DecoderPackConformanceResult {
  const pack = validateDecoderPackRuntime(validateDecoderPack(input));
  const failures: string[] = [];
  let frameCount = 0;

  for (const fixture of pack.fixtures) {
    let parsed;
    try {
      parsed = parseSession(fixtureSession(pack, fixture));
    } catch (error) {
      failures.push(`${fixture.id}: ${error instanceof Error ? error.message : "fixture session could not be parsed"}`);
      continue;
    }

    frameCount += parsed.frames.length;
    if (parsed.frames.length !== fixture.expectedFrames.length) {
      failures.push(`${fixture.id}: expected ${fixture.expectedFrames.length} frame(s), decoded ${parsed.frames.length}`);
      continue;
    }

    fixture.expectedFrames.forEach((expected, index) => {
      const actual = parsed.frames[index];
      if (!actual) return;
      if (actual.status !== expected.status) {
        failures.push(`${fixture.id} frame ${index + 1}: expected status ${expected.status}, received ${actual.status}`);
      }
      if (actual.integrity.status !== expected.integrity) {
        failures.push(`${fixture.id} frame ${index + 1}: expected integrity ${expected.integrity}, received ${actual.integrity.status}`);
      }
      if (actual.familyName !== expected.familyName) {
        failures.push(`${fixture.id} frame ${index + 1}: expected family ${expected.familyName}, received ${actual.familyName}`);
      }
      const actualFields = new Map(actual.fields.map((field) => [field.name, field.value]));
      for (const [name, value] of Object.entries(expected.fields)) {
        if (!actualFields.has(name)) {
          failures.push(`${fixture.id} frame ${index + 1}: expected field ${name} was not decoded`);
        } else if (!valuesMatch(actualFields.get(name), value)) {
          failures.push(`${fixture.id} frame ${index + 1}: field ${name} did not match its expected value`);
        }
      }
    });

    const diagnosticTypes = parsed.diagnostics.map((diagnostic) => diagnostic.type);
    if (
      diagnosticTypes.length !== fixture.expectedDiagnostics.length
      || diagnosticTypes.some((type, index) => type !== fixture.expectedDiagnostics[index])
    ) {
      failures.push(
        `${fixture.id}: expected diagnostics [${fixture.expectedDiagnostics.join(", ")}], received [${diagnosticTypes.join(", ")}]`,
      );
    }
  }

  if (failures.length > 0) {
    throw new DecoderPackValidationError(
      "The decoder pack failed its bundled conformance fixtures.",
      failures.slice(0, 16),
    );
  }

  return {
    pack,
    fixtureIds: pack.fixtures.map((fixture) => fixture.id),
    frameCount,
  };
}
