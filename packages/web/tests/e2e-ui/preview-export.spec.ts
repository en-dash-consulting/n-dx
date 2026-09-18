/**
 * The static export of the demo page keeps its data without JavaScript.
 *
 * The demo renders everything with a script at load time, which is fine on
 * the dev server and was wrong for the file that got sent around: the numbers
 * vanished wherever scripts were blocked or stopped. The exporter bakes the
 * rendered pages into the markup; this spec runs it and reads the result with
 * scripts DISABLED — the exact condition that blanked it — then with scripts
 * on, to make sure the show/hide layer (navigation, collapse, 2D/3D) works.
 *
 * @see scripts/export-preview-demo.mjs
 * @see packages/web/src/preview/option1-demo.html
 */

import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const EXPORTER = join(REPO_ROOT, "scripts/export-preview-demo.mjs");

let dir = "";
let fileUrl = "";

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ndx-preview-export-"));
  const out = join(dir, "demo.html");
  execFileSync(process.execPath, [EXPORTER, out], { stdio: "pipe", timeout: 60_000 });
  fileUrl = pathToFileURL(out).href;
});

test.afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("reads in full with scripts disabled", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(fileUrl, { waitUntil: "load" });

  const visible = page.locator(".page:not([hidden])");
  await expect(visible).toHaveCount(1);
  for (const name of ["General Repository Information", "Repository Map", "PRD Items", "Token Usage"]) {
    await expect(visible.locator(".sec-head h2", { hasText: name })).toBeVisible();
  }
  await expect(visible.locator(".stat", { hasText: "Files" }).first()).toContainText("1,933");
  await expect(visible.locator(".stat", { hasText: "Zones" }).first().locator(".info")).toHaveAttribute("data-info", /Louvain/);
  // The 2D graph is in the markup, not drawn on load.
  await expect(visible.locator("svg:not([hidden]) circle")).not.toHaveCount(0);

  await context.close();
});

test("with scripts on, navigation, collapse and the 2D/3D toggle still work", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(fileUrl, { waitUntil: "load" });

  await page.locator('.nav-section[data-page="work"]').click();
  await expect(page.locator('.page:not([hidden]) h1')).toHaveText("Work");
  await expect(page.locator("#crumbs")).toHaveText("Work");

  await page.locator('.nav-section[data-page="analysis"]').click();
  const panel = page.locator(".panel", { has: page.locator("h3", { hasText: "Zone graph" }) });
  await panel.getByRole("button", { name: "3D" }).click();
  await expect(panel.locator("svg:not([hidden]) polygon")).not.toHaveCount(0);
  await expect(panel.locator("svg:not([hidden]) circle")).toHaveCount(0);
  await panel.getByRole("button", { name: "2D" }).click();
  await expect(panel.locator("svg:not([hidden]) circle")).not.toHaveCount(0);

  const usage = page.locator(".sec", { has: page.locator("h2", { hasText: "Token Usage" }) });
  await usage.locator(".sec-head").click();
  await expect(usage.locator(".panel:visible")).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("never reaches the network or reloads itself", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (req) => { if (!req.url().startsWith("file:")) requests.push(req.url()); });
  await page.goto(fileUrl, { waitUntil: "load" });
  await page.waitForTimeout(1_500);
  expect(requests).toEqual([]);
  const html = await page.content();
  expect(html).not.toMatch(/location\.reload|setInterval|fetch\(/);
});
