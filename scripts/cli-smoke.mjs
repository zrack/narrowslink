import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const outputDirectory = join(projectRoot, "dist-cli");
const cliPath = join(outputDirectory, "narrowslink.mjs");
const outputFiles = readdirSync(outputDirectory).sort();
if (outputFiles.some((path) => path !== "narrowslink.mjs" && path !== "narrowslink.mjs.map")) {
  throw new Error(`CLI build contains unrelated public assets: ${outputFiles.join(", ")}`);
}
if (!readFileSync(cliPath, "utf8").startsWith("#!/usr/bin/env node\n")) {
  throw new Error("CLI build is missing its Node shebang.");
}

const directory = mkdtempSync(join(tmpdir(), "narrowslink-cli-smoke-"));
const symlinkPath = join(directory, "narrowslink-bin.mjs");
try {
  symlinkSync(cliPath, symlinkPath);
  if (realpathSync(symlinkPath) !== realpathSync(cliPath)) throw new Error("CLI smoke symlink did not resolve to the build.");

  for (const invokedPath of [cliPath, symlinkPath]) {
    const result = spawnSync(process.execPath, [invokedPath, "--help"], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout.includes("Usage: narrowslink verify")) {
      throw new Error(`CLI entry smoke failed for ${invokedPath}: ${result.stderr || result.stdout}`);
    }
  }

  const usage = spawnSync(process.execPath, [symlinkPath, "--json"], { encoding: "utf8" });
  if (usage.status !== 2) throw new Error(`CLI JSON usage exit was ${usage.status}; expected 2.`);
  const report = JSON.parse(usage.stdout);
  if (report.integrity !== "failed" || report.error?.code !== "USAGE_ERROR") {
    throw new Error("CLI JSON usage report is not stable.");
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("NarrowsLink receiver CLI build smoke passed.");
