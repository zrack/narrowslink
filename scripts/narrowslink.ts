import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  EvidenceVerificationError,
  verifyEvidenceBundleFile,
  type EvidenceVerificationReport,
} from "../verifier/evidence-verifier";

interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface FailedVerificationReport {
  format: "narrowslink/bundle-verification-report";
  formatVersion: 1;
  integrity: "failed";
  authenticity: "not-established";
  error: {
    code: string;
    message: string;
    path?: string;
  };
}

const DEFAULT_IO: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

function cleanTerminalText(value: string): string {
  return value.replace(
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/gu,
    (character) => `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0") ?? "fffd"}`,
  );
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/gu,
    (character) => `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0") ?? "fffd"}`,
  );
}

export function renderVerificationReport(report: EvidenceVerificationReport): string {
  const warnings = report.warnings.length === 0
    ? "Warnings: none"
    : ["Warnings:", ...report.warnings.map((warning) => `  - ${cleanTerminalText(warning)}`)].join("\n");
  return [
    "NarrowsLink evidence verification: PASS",
    `Integrity: ${report.integrity}`,
    `Evidence: ${report.evidence} (capture: ${report.captureEvidence}; provenance: ${report.provenanceEvidence})`,
    `Authenticity: ${report.authenticity} (bundle is unsigned)`,
    `Bundle SHA-256: ${report.bundle.sha256}`,
    `Bundle bytes: ${report.bundle.bytes}`,
    `Session: ${cleanTerminalText(report.session.title)} [${cleanTerminalText(report.session.id)}]`,
    `Source: ${cleanTerminalText(report.session.sourceId)}; session format: v${report.session.formatVersion}`,
    `Selection: [${report.selection.startUs}, ${report.selection.endUs}) microseconds`,
    `Artifacts: ${report.artifacts.count}`,
    warnings,
    "",
  ].join("\n");
}

function failureReport(error: EvidenceVerificationError): FailedVerificationReport {
  return {
    format: "narrowslink/bundle-verification-report",
    formatVersion: 1,
    integrity: "failed",
    authenticity: "not-established",
    error: {
      code: error.code,
      message: error.message,
      ...(error.path ? { path: error.path } : {}),
    },
  };
}

function usage(): string {
  return [
    "Usage: narrowslink verify <bundle.nlb> [--json]",
    "",
    "Verifies a NarrowsLink v3 evidence bundle locally without network access.",
    "Exit 0: internally consistent; exit 1: invalid or tampered; exit 2: usage or file I/O failure.",
    "",
  ].join("\n");
}

export async function runCli(argv: readonly string[], io: CliIo = DEFAULT_IO): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout(usage());
    return 0;
  }
  const json = argv.includes("--json");
  const positional = argv.filter((argument) => argument !== "--json");
  if (positional.length !== 2 || positional[0] !== "verify" || positional[1] === "") {
    if (json) {
      io.stdout(`${safeJson({
        format: "narrowslink/bundle-verification-report",
        formatVersion: 1,
        integrity: "failed",
        authenticity: "not-established",
        error: { code: "USAGE_ERROR", message: "Expected: narrowslink verify <bundle.nlb> [--json]" },
      } satisfies FailedVerificationReport)}\n`);
    } else {
      io.stderr(usage());
    }
    return 2;
  }

  try {
    const verified = await verifyEvidenceBundleFile(positional[1] ?? "");
    io.stdout(json ? `${safeJson(verified.report)}\n` : renderVerificationReport(verified.report));
    return 0;
  } catch (error) {
    const verificationError = error instanceof EvidenceVerificationError
      ? error
      : new EvidenceVerificationError("CONTENT_INVALID", "Evidence verification failed unexpectedly.", undefined, { cause: error });
    const exitCode = verificationError.code === "ARCHIVE_IO_ERROR" ? 2 : 1;
    if (json) io.stdout(`${safeJson(failureReport(verificationError))}\n`);
    else io.stderr(`NarrowsLink evidence verification: FAIL\n${verificationError.code}: ${cleanTerminalText(verificationError.message)}${verificationError.path ? `\nPath: ${cleanTerminalText(verificationError.path)}` : ""}\n`);
    return exitCode;
  }
}

export function isCliEntry(moduleUrl: string, entryPath: string): boolean {
  try {
    return moduleUrl === pathToFileURL(realpathSync(entryPath)).href;
  } catch {
    return moduleUrl === pathToFileURL(entryPath).href;
  }
}

const entryPath = process.argv[1];
if (entryPath && isCliEntry(import.meta.url, entryPath)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
