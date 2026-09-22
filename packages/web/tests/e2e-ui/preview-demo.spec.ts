/**
 * The option 1 demo page renders every page without errors, and its zone graph
 * is one panel with two projections.
 *
 * The demo is hand-built HTML with real numbers baked in; the thing that can
 * silently break is the script — a typo in one data row blanks a whole page
 * while the file still parses. So each page is opened and checked for its
 * headline section, with the console watched for anything thrown.
 *
 * The 2D / 3D toggle is asserted specifically: the request was one panel the
 * reader can flip, not two panels. Flipping must swap the drawing in place and
 * keep the panel's heading, and the choice has to survive a reload.
 *
 * @see packages/web/src/preview/option1-demo.html
 */

import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const WEB_CLI = join(REPO_ROOT, "packages/web/dist/cli/index.js");
const PREVIEW_SRC = join(REPO_ROOT, "packages/web/src/preview");

let dir = "";
let proc: ChildProcess | null = null;
let baseUrl = "";

function getFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForReady(url: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Preview server never became ready at ${url}`);
}

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ndx-preview-demo-"));
  for (const file of ["index.html", "index.layout.json", "option1-demo.html"]) {
    await copyFile(join(PREVIEW_SRC, file), join(dir, file));
  }
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  proc = spawn("node", [WEB_CLI, "preview", `--port=${port}`, `--file=${join(dir, "index.html")}`, dir], { stdio: "pipe" });
  await waitForReady(baseUrl + "/option1-demo.html");
});

test.afterAll(async () => {
  proc?.kill("SIGTERM");
  if (dir) await rm(dir, { recursive: true, force: true });
});

function watchErrors(page: any): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err: Error) => errors.push(String(err)));
  page.on("console", (msg: any) => { if (msg.type() === "error") errors.push(msg.text()); });
  return errors;
}

test("every page renders its headline sections without throwing", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(baseUrl + "/option1-demo.html#analysis", { waitUntil: "networkidle" });

  for (const name of ["General Repository Information", "Repository Map", "PRD Items", "Token Usage"]) {
    await expect(page.locator(".sec-head h2", { hasText: name })).toBeVisible();
  }
  // Real numbers from this repo's analysis, not placeholders.
  await expect(page.locator(".stat", { hasText: "Files" }).first()).toContainText("1,933");
  await expect(page.locator(".stat", { hasText: "Zones" }).first().locator(".info")).toHaveAttribute("data-info", /Louvain/);

  await page.locator('.nav-section[data-page="plan"]').click();
  for (const name of ["History", "CLI help", "Basic Planning Settings"]) {
    await expect(page.locator(".sec-head h2", { hasText: name })).toBeVisible();
  }
  await expect(page.locator(".panel h3", { hasText: "Add Items" })).toBeVisible();

  await page.locator('.nav-section[data-page="work"]').click();
  for (const name of ["Templates", "Commands", "Usage"]) {
    await expect(page.locator(".sec-head h2", { hasText: name })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /Run this task with the agent/ })).toBeVisible();

  await page.locator("#commands-toggle").click();
  await expect(page.locator("#commands-sheet .panel h3", { hasText: "All Commands" })).toBeVisible();

  await page.locator("#settings-toggle").click();
  await page.locator('.nav-item[data-page="s-work"]').click();
  await expect(page.locator("#settings-overlay .panel h3", { hasText: "ndx work" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("the stage links step around the Analysis → Plan → Work loop", async ({ page }) => {
  await page.goto(baseUrl + "/option1-demo.html#analysis", { waitUntil: "networkidle" });
  const shown = page.locator(".stage-link:visible");

  // Two links per page: the previous stage on the left, the next on the right.
  await expect(shown).toHaveCount(2);
  await expect(shown.filter({ hasText: "prev" })).toContainText("Work");
  await expect(shown.filter({ hasText: "next" })).toContainText("Plan");

  await shown.filter({ hasText: "next" }).click();
  await expect(page.locator("#content h1")).toHaveText("Plan");
  await expect(page.locator('.nav-section[data-page="plan"]')).toHaveClass(/active/);
  await shown.filter({ hasText: "next" }).click();
  await expect(page.locator("#content h1")).toHaveText("Work");
  await shown.filter({ hasText: "next" }).click();         // wraps around
  await expect(page.locator("#content h1")).toHaveText("Analysis");
  await shown.filter({ hasText: "prev" }).click();         // and back the other way
  await expect(page.locator("#content h1")).toHaveText("Work");
});

test("commands lift from the bottom bar; settings open from the cog and close with ✕", async ({ page }) => {
  await page.goto(baseUrl + "/option1-demo.html#plan", { waitUntil: "networkidle" });
  const sheet = page.locator("#commands-sheet");
  const overlay = page.locator("#settings-overlay");
  const toggle = page.locator("#commands-toggle");

  await expect(sheet).toBeHidden();
  await toggle.click();
  await expect(sheet).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(sheet.locator(".panel h3", { hasText: "Run a command" })).toBeVisible();
  await expect(sheet.locator(".panel h3", { hasText: "All Commands" })).toBeVisible();
  // The Plan page is still there beneath the sheet.
  await expect(page.locator("#content h1")).toHaveText("Plan");
  await toggle.click();                                    // same button closes it
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/#plan$/);

  await page.locator("#settings-toggle").click();
  await expect(overlay).toBeVisible();
  await expect(overlay.locator("#crumbs")).toHaveText("Settings / General");
  await page.locator('.nav-item[data-page="s-timeouts"]').click();
  await expect(overlay.locator("#crumbs")).toHaveText("Settings / CLI Timeouts");
  await expect(overlay.locator(".panel h3", { hasText: "CLI Timeouts" })).toBeVisible();
  await overlay.getByRole("button", { name: "Close settings" }).click();
  await expect(overlay).toBeHidden();
  await expect(page.locator("#content h1")).toHaveText("Plan");
  await expect(page).toHaveURL(/#plan$/);
  // The cog reopens on the page last visited.
  await page.locator("#settings-toggle").click();
  await expect(overlay.locator("#crumbs")).toHaveText("Settings / CLI Timeouts");
});

test("the zone graph is one panel that flips between 2D and 3D", async ({ page }) => {
  await page.goto(baseUrl + "/option1-demo.html#analysis", { waitUntil: "networkidle" });

  const panel = page.locator(".panel", { has: page.locator("h3", { hasText: "Zone graph" }) });
  await expect(panel).toHaveCount(1);

  // 2D: nodes are circles.
  await panel.getByRole("button", { name: "2D" }).click();
  await expect(panel.locator("svg circle")).not.toHaveCount(0);
  await expect(panel.locator("svg polygon")).toHaveCount(0);

  // 3D: the same panel, now isometric blocks; nothing else on the page moved.
  await panel.getByRole("button", { name: "3D" }).click();
  await expect(panel.locator("svg polygon")).not.toHaveCount(0);
  await expect(panel.locator("svg circle")).toHaveCount(0);
  await expect(panel.locator("h3")).toHaveText("Zone graph");
  await expect(page.locator(".panel", { has: page.locator("h3", { hasText: "Zone graph" }) })).toHaveCount(1);

  // The choice sticks.
  await page.reload({ waitUntil: "networkidle" });
  await expect(panel.getByRole("button", { name: "3D" })).toHaveAttribute("aria-pressed", "true");
});

test("collapsing a section hides its panels and keeps the header", async ({ page }) => {
  await page.goto(baseUrl + "/option1-demo.html#analysis", { waitUntil: "networkidle" });
  const sec = page.locator(".sec", { has: page.locator("h2", { hasText: "Token Usage" }) });
  await expect(sec.locator(".panel")).toHaveCount(3);
  await sec.locator(".sec-head").click();
  await expect(sec.locator(".panel:visible")).toHaveCount(0);
  await expect(sec.locator("h2")).toBeVisible();
});
