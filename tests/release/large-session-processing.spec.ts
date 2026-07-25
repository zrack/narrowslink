import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";

import { LARGE_SESSION_SUPPORT_TIER } from "../../src/domain/limits";
import {
  configuredReleaseArchive,
  startRelease,
  unpackRelease,
  type ReleaseInstallation,
  type RunningRelease,
} from "./support/release";

const execFileAsync = promisify(execFile);
const LARGE_SESSION_TITLE = "NarrowsLink scale acceptance - 200,000 records";
const LARGE_SESSION_PATH = path.join(
  process.cwd(),
  "output",
  "large-session",
  "scale-acceptance-200k.nlsession",
);

test.describe.configure({ timeout: 360_000 });

test.beforeAll(async () => {
  try {
    await access(LARGE_SESSION_PATH);
  } catch {
    await execFileAsync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "large-session-corpus.mjs"),
        "--output",
        LARGE_SESSION_PATH,
      ],
      { cwd: process.cwd() },
    );
  }
});

async function armHeartbeatForReplayImport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      "input[aria-label='Choose a local NarrowsLink replay']",
    );
    if (!input) throw new Error("The packaged replay input is unavailable.");
    input.addEventListener("change", () => {
      const scope = globalThis as typeof globalThis & {
        __narrowslinkReleaseHeartbeat?: {
          timer: number;
          previousAt: number;
          ticks: number;
          maximumGapMs: number;
        };
      };
      const previousAt = performance.now();
      const heartbeat = {
        timer: 0,
        previousAt,
        ticks: 0,
        maximumGapMs: 0,
      };
      heartbeat.timer = window.setInterval(() => {
        const now = performance.now();
        heartbeat.maximumGapMs = Math.max(
          heartbeat.maximumGapMs,
          now - heartbeat.previousAt,
        );
        heartbeat.previousAt = now;
        heartbeat.ticks += 1;
      }, 25);
      scope.__narrowslinkReleaseHeartbeat = heartbeat;
    }, { capture: true, once: true });
  });
}

async function stopHeartbeat(page: Page): Promise<{
  ticks: number;
  maximumGapMs: number;
}> {
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __narrowslinkReleaseHeartbeat?: {
        timer: number;
        previousAt: number;
        ticks: number;
        maximumGapMs: number;
      };
    };
    const heartbeat = scope.__narrowslinkReleaseHeartbeat;
    if (!heartbeat) throw new Error("The packaged large-session heartbeat was not started.");
    window.clearInterval(heartbeat.timer);
    const now = performance.now();
    const report = {
      ticks: heartbeat.ticks,
      maximumGapMs: Math.max(
        heartbeat.maximumGapMs,
        now - heartbeat.previousAt,
      ),
    };
    delete scope.__narrowslinkReleaseHeartbeat;
    return report;
  });
}

test("unpacked release processes and persists the maximum replay tier", async ({ page }) => {
  let installation: ReleaseInstallation | undefined;
  let server: RunningRelease | undefined;
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  try {
    installation = await unpackRelease(configuredReleaseArchive());
    server = await startRelease(installation);
    await page.goto(server.ready.appUrl);
    await expect(page.getByRole("heading", { name: "Harbor relay downlink", level: 1 }))
      .toBeVisible();

    await armHeartbeatForReplayImport(page);
    await page.getByLabel("Choose a local NarrowsLink replay")
      .setInputFiles(LARGE_SESSION_PATH);
    await expect(page.getByRole("heading", { name: LARGE_SESSION_TITLE, level: 1 }))
      .toBeVisible({ timeout: 240_000 });
    await expect(page.locator(".saved-sessions .saved-session-entry")).toHaveCount(1, {
      timeout: 90_000,
    });
    const heartbeat = await stopHeartbeat(page);
    expect(heartbeat.ticks).toBeGreaterThan(0);
    expect(heartbeat.maximumGapMs).toBeLessThanOrEqual(
      LARGE_SESSION_SUPPORT_TIER.maxMainThreadHeartbeatGapMs,
    );
    await expect(page.locator(".session-info").getByText("200,000", { exact: true }))
      .toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Harbor relay downlink", level: 1 }))
      .toBeVisible();
    await page.getByRole("button", {
      name: new RegExp(`Open saved session ${LARGE_SESSION_TITLE}`),
    }).click();
    await expect(page.getByRole("dialog", {
      name: `Processing ${LARGE_SESSION_TITLE}`,
    })).toBeVisible();
    await expect(page.getByRole("heading", { name: LARGE_SESSION_TITLE, level: 1 }))
      .toBeVisible({ timeout: 240_000 });
    expect(browserErrors).toEqual([]);
  } finally {
    await server?.stop().catch(() => undefined);
    await installation?.remove().catch(() => undefined);
  }
});
