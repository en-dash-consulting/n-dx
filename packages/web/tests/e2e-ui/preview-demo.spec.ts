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

  for (const name of ["General Repository Information", "Repository Map", "Token Usage"]) {
    await expect(page.locator(".sec-head h2", { hasText: name })).toBeVisible();
  }
  // PRD state moved to Work; nothing of it should remain here.
  await expect(page.locator(".sec-head h2", { hasText: "PRD Items" })).toHaveCount(0);
  // Real numbers from this repo's analysis, not placeholders.
  await expect(page.locator(".stat", { hasText: "Files" }).first()).toContainText("1,933");
  await expect(page.locator(".stat", { hasText: "Zones" }).first().locator(".info")).toHaveAttribute("data-info", /Louvain/);

  await page.locator('.nav-section[data-page="plan"]').click();
  // Order matters: the command runner and reference sit above the run history.
  await expect(page.locator("#content .sec:not(.plain) .sec-head h2")).toHaveText(["CLI help", "History", "Basic Planning Settings"]);
  await expect(page.locator(".panel h3", { hasText: "Add Items" })).toBeVisible();

  await page.locator('.nav-section[data-page="work"]').click();
  // Order matters: PRD Items directly above History, both above Templates.
  // (.plain excludes the headerless top section, whose h2 is empty.)
  const workSections = page.locator("#content .sec:not(.plain) .sec-head h2");
  await expect(workSections).toHaveText(["PRD Items", "History", "Templates", "Commands", "Usage"]);
  await expect(page.locator(".stat", { hasText: "Complete" }).first()).toContainText("96.4%");
  await expect(page.getByRole("button", { name: /Run this task with the agent/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify criteria" })).toBeVisible();

  await page.locator("#commands-toggle").click();
  await expect(page.locator("#commands-sheet .panel h3", { hasText: "All Commands" })).toBeVisible();

  await page.locator("#settings-toggle").click();
  await page.locator('.nav-item[data-page="s-work"]').click();
  await expect(page.locator("#settings-overlay .panel h3", { hasText: "ndx work" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("the landing page is three stage cards that go where they say, highlighted like the stage links", async ({ page }) => {
  await page.goto(baseUrl + "/option1-demo.html", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator("#content h1")).toHaveText("n-dx");

  // Three columns side by side, in loop order, each headed by its package mark
  // and carrying real headline numbers.
  const cards = page.locator(".landing .stage-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.locator(".name")).toHaveText(["Analysis", "Plan", "Work"]);
  const boxes = await cards.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; }));
  expect(boxes[0].left).toBeLessThan(boxes[1].left);
  expect(boxes[1].left).toBeLessThan(boxes[2].left);
  expect(boxes[0].top).toBe(boxes[1].top);
  expect(boxes[1].top).toBe(boxes[2].top);
  for (const b of boxes) expect(b.h).toBeGreaterThan(b.w);            // tall bars, not wide rows
  for (let i = 0; i < 3; i++) {
    const img = cards.nth(i).locator(".mark img");
    await expect(img).toHaveAttribute("src", /^data:image\/png;base64,/); // inlined, never fetched
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await expect(cards.nth(0).locator(".facts")).toContainText("1,933");
  await expect(cards.nth(1).locator(".facts")).toContainText("1,548");
  await expect(cards.nth(2).locator(".facts")).toContainText("1,146");
  // No stage links on the landing page — there is no previous or next stage yet.
  await expect(page.locator(".stage-link:visible")).toHaveCount(0);

  // Hover highlights the card with the accent border and accent name; the side
  // stage links get the identical treatment. Both are asserted against the
  // theme's --accent token, resolved to rgb the way the browser reports it.
  // The highlight is transitioned (150ms), so every colour check below is a
  // retrying toHaveCSS rather than a one-shot sample — a sample taken the
  // instant after hover() reads a mid-transition colour.
  const accent = await page.evaluate(() => {
    const s = document.createElement("span");
    s.style.color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    document.body.appendChild(s);
    const v = getComputedStyle(s).color;
    s.remove();
    return v;
  });
  await expect(cards.nth(1)).not.toHaveCSS("border-top-color", accent);   // resting
  await cards.nth(1).hover();
  await expect(cards.nth(1)).toHaveCSS("border-top-color", accent);
  await expect(cards.nth(1).locator(".name")).toHaveCSS("color", accent);

  await cards.nth(1).click();
  await expect(page.locator("#content h1")).toHaveText("Plan");
  await expect(page.locator('.nav-section[data-page="plan"]')).toHaveClass(/active/);

  const link = page.locator(".stage-link:visible", { hasText: "next" });
  await expect(link).not.toHaveCSS("border-top-color", accent);           // resting
  await link.hover();
  await expect(link).toHaveCSS("border-top-color", accent);
  await expect(link.locator(".n")).toHaveCSS("color", accent);

  // The logo is the way back.
  await page.locator(".brand").click();
  await expect(page.locator("#content h1")).toHaveText("n-dx");
  await expect(page).toHaveURL(/#home$/);
});

test("theme follows the system by default and can be pinned to light or dark", async ({ page }) => {
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const root = page.locator("html");
  const pressed = (pref: string) => page.locator(`#theme-toggle button[data-theme-pref="${pref}"]`);

  // System: nothing pinned on <html>, and the palette tracks prefers-color-scheme live.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(baseUrl + "/option1-demo.html", { waitUntil: "networkidle" });
  await expect(root).not.toHaveAttribute("data-theme", /./);
  await expect(pressed("system")).toHaveAttribute("aria-pressed", "true");
  const dark = await bg();
  await page.emulateMedia({ colorScheme: "light" });
  const light = await bg();
  expect(light).not.toBe(dark);

  // Pinning dark wins over a light system, and survives a reload.
  await pressed("dark").click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(pressed("dark")).toHaveAttribute("aria-pressed", "true");
  expect(await bg()).toBe(dark);
  await page.reload({ waitUntil: "networkidle" });
  await expect(root).toHaveAttribute("data-theme", "dark");
  expect(await bg()).toBe(dark);

  // Pinning light on a dark system is the mirror image.
  await page.emulateMedia({ colorScheme: "dark" });
  await pressed("light").click();
  await expect(root).toHaveAttribute("data-theme", "light");
  expect(await bg()).toBe(light);

  // Back to system: the attribute goes, and the system (dark) shows through.
  await pressed("system").click();
  await expect(root).not.toHaveAttribute("data-theme", /./);
  expect(await bg()).toBe(dark);
  await page.reload({ waitUntil: "networkidle" });
  await expect(pressed("system")).toHaveAttribute("aria-pressed", "true");
  await expect(root).not.toHaveAttribute("data-theme", /./);
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
