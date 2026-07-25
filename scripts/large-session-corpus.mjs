import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LARGE_SESSION_RECORD_COUNT = 200_000;
export const LARGE_SESSION_TITLE = "NarrowsLink scale acceptance - 200,000 records";
export const LARGE_SESSION_ID = "narrowslink-scale-acceptance-200k";
export const LARGE_SESSION_RANGE_TITLE = "Ten-second scale evidence window";

const SOURCE_ID = "scale-acceptance-udp";
const RECORD_SPACING_US = 1_000;
const RANGE_START_US = 80_000_000;
const RANGE_END_US = 90_000_000;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PATH = resolve(REPOSITORY_ROOT, "public", "fixtures", "harbor-relay-session.json");

function parseArguments(argv) {
  const result = {
    output: resolve(REPOSITORY_ROOT, "output", "large-session", "scale-acceptance-200k.nlsession"),
    records: LARGE_SESSION_RECORD_COUNT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output requires a file path.");
      result.output = resolve(value);
      index += 1;
    } else if (argument === "--records") {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1 || value > LARGE_SESSION_RECORD_COUNT) {
        throw new Error(`--records must be an integer from 1 to ${LARGE_SESSION_RECORD_COUNT}.`);
      }
      result.records = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return result;
}

async function writeChunk(stream, hash, text) {
  hash.update(text, "utf8");
  if (!stream.write(text, "utf8")) await once(stream, "drain");
}

export async function generateLargeSession(outputPath, recordCount = LARGE_SESSION_RECORD_COUNT) {
  if (!Number.isSafeInteger(recordCount) || recordCount < 1 || recordCount > LARGE_SESSION_RECORD_COUNT) {
    throw new RangeError(`recordCount must be between 1 and ${LARGE_SESSION_RECORD_COUNT}.`);
  }
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const sample = fixture.records?.[0];
  if (
    fixture.formatVersion !== 1
    || typeof sample?.dataHex !== "string"
    || !Number.isSafeInteger(sample.captureBytes)
  ) {
    throw new Error("The bundled replay does not expose a valid version 1 source record.");
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const stream = createWriteStream(outputPath, { encoding: "utf8" });
  const hash = createHash("sha256");
  const durationUs = recordCount * RECORD_SPACING_US + 1;
  const boundedRangeStartUs = Math.min(RANGE_START_US, Math.max(0, durationUs - 2));
  const boundedRangeEndUs = Math.min(
    durationUs,
    Math.max(boundedRangeStartUs + 1, Math.min(RANGE_END_US, durationUs)),
  );
  const header = {
    format: "narrowslink/session",
    id: LARGE_SESSION_ID,
    title: LARGE_SESSION_TITLE,
    startedAt: "2026-07-24T12:00:00.000Z",
    displayTimeZone: "America/Los_Angeles",
    durationUs,
    source: {
      id: SOURCE_ID,
      kind: "udp",
      label: "Deterministic large-session UDP corpus",
      address: "239.42.91.4",
      port: 9104,
    },
    decoder: fixture.decoder,
  };

  try {
    await writeChunk(stream, hash, `${JSON.stringify(header).slice(0, -1)},"records":[`);
    for (let index = 0; index < recordCount; index += 1) {
      const record = {
        id: `scale-${String(index + 1).padStart(6, "0")}`,
        index,
        sourceId: SOURCE_ID,
        offsetUs: index * RECORD_SPACING_US,
        dataHex: sample.dataHex,
        captureBytes: sample.captureBytes,
        wireBytes: sample.captureBytes + 42,
        transport: {
          kind: "udp",
          kernelDropCounter: 0,
        },
      };
      await writeChunk(stream, hash, `${index === 0 ? "" : ","}${JSON.stringify(record)}`);
    }
    const incidents = [{
      id: "scale-evidence-window",
      title: LARGE_SESSION_RANGE_TITLE,
      startUs: boundedRangeStartUs,
      endUs: boundedRangeEndUs,
      severity: "info",
    }];
    await writeChunk(
      stream,
      hash,
      `],"incidents":${JSON.stringify(incidents)},"formatVersion":1}\n`,
    );
    stream.end();
    await once(stream, "finish");
  } catch (error) {
    stream.destroy();
    throw error;
  }

  const details = await stat(outputPath);
  return {
    output: outputPath,
    bytes: details.size,
    records: recordCount,
    durationUs,
    sha256: hash.digest("hex"),
    range: {
      title: LARGE_SESSION_RANGE_TITLE,
      startUs: boundedRangeStartUs,
      endUs: boundedRangeEndUs,
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const report = await generateLargeSession(options.output, options.records);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
