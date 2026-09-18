/**
 * The preview document's editor — the shuffling actually has to work.
 *
 * `ndx start --preview` exists so someone can rearrange the dashboard's
 * sections in a browser and hand the result to reviewers. Three things have to
 * hold for that to be true, and none of them can be checked without a real
 * browser:
 *
 *  1. **Renames stay traceable.** A renamed section renders as
 *     "New (previously Old)" — a reviewer reading the mock has to see what it
 *     used to be, and the annotation must survive the round-trip to disk.
 *  2. **A section can be nested into a group.** Dropping a folder onto the
 *     middle of another folder is the gesture for "put these sections in a
 *     named dropdown"; before/after dropping is ordinary reordering. Getting
 *     the middle band wrong silently turns every nest into a reorder.
 *  3. **Edits reach the layout file.** The page is the editor, the JSON is the
 *     artifact. An edit that only lives in the DOM is lost on reload and shows
 *     up in nobody's diff.
 *
 * The spec runs against a COPY of the shipped document in a temp directory, so
 * a test run never rewrites the seed layout in the repo.
 *
 * @see packages/web/src/preview/index.html
 * @see packages/web/src/server/preview.ts
 */

import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, copyFile, readFile, rm } from "node:fs/promises";
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

/**
 * Expand a top-level group if it is collapsed.
 *
 * Collapsed state is view state that lives in the layout file, so whatever the
 * last editing session left behind is what a test opens to. Specs expand what
 * they need rather than assuming.
 */
async function expandGroup(page: any, label: string): Promise<void> {
  const caret = page.locator(`.row-folder:has(.label:text-is("${label}")) .caret`).first();
  if ((await caret.textContent())?.trim() === "▸") await caret.click();
}

/** Collapse every top-level group and return the rail to the top. */
async function collapseAllGroups(page: any): Promise<void> {
  const carets = page.locator("#nav-root > .row-folder.depth-0 .caret");
  const count = await carets.count();
  for (let i = count - 1; i >= 0; i--) await carets.nth(i).click();
  await page.locator(".sidebar").evaluate((el: HTMLElement) => { el.scrollTop = 0; });
}

/**
 * Drag `source` onto the middle of `target` — the "nest inside" gesture.
 *
 * `dragTo` (not hand-driven mouse events): Playwright synthesizes the HTML5
 * drag operation there, where raw `mouse.down`/`move` never fires `dragstart`
 * in Chromium. The explicit centre `targetPosition` is the point of the test —
 * the middle band is "inside", the edges are ordinary reordering. Callers must
 * make sure both rows are on screen: a rail that scrolls mid-gesture drags
 * whichever row slides under the pointer instead.
 */
async function dragOnto(source: any, target: any): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("drag target is not on screen");
  await source.dragTo(target, { targetPosition: { x: box.width / 2, y: box.height / 2 } });
}

/** The layout as it exists on disk right now. */
async function savedLayout(): Promise<any> {
  return JSON.parse(await readFile(join(dir, "index.layout.json"), "utf-8"));
}

/** Find a nav node anywhere in the saved tree. */
function findNode(nodes: any[], label: string): any | null {
  for (const node of nodes) {
    if (node.label === label) return node;
    const nested = node.children ? findNode(node.children, label) : null;
    if (nested) return nested;
  }
  return null;
}

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ndx-preview-ui-"));
  await copyFile(join(PREVIEW_SRC, "index.html"), join(dir, "index.html"));
  await copyFile(join(PREVIEW_SRC, "index.layout.json"), join(dir, "index.layout.json"));

  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  proc = spawn("node", [WEB_CLI, "preview", `--port=${port}`, `--file=${join(dir, "index.html")}`, dir], {
    stdio: "pipe",
  });
  await waitForReady(baseUrl + "/");
});

test.afterAll(async () => {
  proc?.kill("SIGTERM");
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("renders the shipped section inventory", async ({ page }) => {
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  for (const group of ["Analysis", "Plan", "Work", "SETTINGS"]) {
    await expect(page.locator(".row-folder", { hasText: group }).first()).toBeVisible();
  }
  // Renamed sections carry their old name with them.
  await expect(page.locator('.row-folder:has(.label:text-is("Analysis"))').first().locator(".prev"))
    .toHaveText("(previously SOURCEVISION)");
});

test("a section is a page: clicking it shows its own named sections", async ({ page }) => {
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  // Start somewhere else, then click the section header itself.
  await expandGroup(page, "Analysis");
  await page.locator('.row-item:has(.label:text-is("Map"))').first().click();
  await expect(page.locator("#view-title")).toHaveText("Map");

  await page.locator('.row-folder:has(.label:text-is("Analysis"))').first().click();
  await expect(page.locator("#view-title")).toHaveText("Analysis");

  const section = page.locator('.pgroup:has(.label:text-is("General Repository Information"))');
  await expect(section).toBeVisible();
  await expect(section.locator(".panel", { hasText: "Counts" })).toBeVisible();
  await expect(section.locator(".panel", { hasText: "Health & coupling" })).toBeVisible();

  // The zone count carries a hover explainer — the whole reason that stat needs
  // one is that "zone" means nothing to a reader who has not met the analyser.
  const zoneInfo = section.locator(".stat-item", { hasText: "Zones" }).locator(".info");
  await expect(zoneInfo).toHaveAttribute("data-info", /Louvain community detection/);

  // Collapsing the section hides its panels but keeps the header — that is what
  // makes it a dropdown rather than a heading.
  await section.locator(".caret").first().click();
  await expect(section.locator(".panel")).toHaveCount(0);
  await expect(section.locator('.label:text-is("General Repository Information")')).toBeVisible();
});

test("a rename shows '(previously …)' and reaches the layout file", async ({ page }) => {
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  await expandGroup(page, "Plan");
  const label = page.locator('.row-item:has(.label:text-is("Tasks"))').first().locator(".label");
  await label.click({ clickCount: 3 });
  await page.keyboard.type("Backlog");
  await page.keyboard.press("Enter");

  const renamed = page.locator('.row-item:has(.label:text-is("Backlog"))').first();
  await expect(renamed.locator(".prev")).toHaveText("(previously Tasks)");

  await expect
    .poll(async () => findNode((await savedLayout()).nav, "Backlog")?.previousLabel, { timeout: 5_000 })
    .toBe("Tasks");
});

test("dropping a section on the middle of a group nests it inside", async ({ page }) => {
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  // Collapse everything so source and target are on screen together. A rail
  // that scrolls between mousedown and the first move hands the drag to
  // whichever row slides under the pointer — an artifact of driving the mouse,
  // not of the editor.
  await collapseAllGroups(page);

  // A fresh group to nest into, created through the UI the same way a user would.
  await page.locator("#add-group").click();
  const newGroup = page.locator('.row-folder:has(.label:text-is("New group"))').first();
  await expect(newGroup).toBeVisible();

  const work = page.locator('.row-folder:has(.label:text-is("Work"))').first();
  await dragOnto(work, newGroup);

  await expect
    .poll(
      async () => {
        const saved = await savedLayout();
        const group = findNode(saved.nav, "New group");
        return (group?.children ?? []).map((c: any) => c.label);
      },
      { timeout: 5_000 },
    )
    .toContain("Work");

  // And the nested section is marked as moved, so the change list reports it.
  const saved = await savedLayout();
  expect(findNode(saved.nav, "Work").status).toBe("moved");
});

test("Alt+Right nests a section into the group above it", async ({ page }) => {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await collapseAllGroups(page);

  // Put a fresh group directly above the section being nested.
  await page.locator("#add-group").click();
  const created = page.locator('.row-folder:has(.label:text-is("New group"))').last();
  await expect(created).toBeVisible();

  const settings = page.locator('.row-folder:has(.label:text-is("SETTINGS"))').first();
  await settings.focus();
  await page.keyboard.press("Alt+ArrowDown");   // move below the new group
  await page.keyboard.press("Alt+ArrowRight");  // nest into it

  await expect
    .poll(
      async () => {
        const saved = await savedLayout();
        const groups = saved.nav.filter((n: any) => n.label === "New group");
        return groups.flatMap((g: any) => (g.children ?? []).map((c: any) => c.label));
      },
      { timeout: 5_000 },
    )
    .toContain("SETTINGS");
});

test("cutting a panel marks it before deleting it", async ({ page }) => {
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  await expandGroup(page, "Analysis");
  await page.locator('.row-item:has(.label:text-is("Overview"))').first().click();
  const panel = page.locator(".panel", { hasText: "Languages" }).first();
  await panel.hover();
  await panel.getByTitle("Mark as cut").click();

  await expect(panel.locator(".chip-removed")).toHaveText("cut");

  await expect
    .poll(async () => {
      const saved = await savedLayout();
      const overview = findNode(saved.nav, "Overview");
      const panels = (overview.content ?? []).flatMap((group: any) => group.panels ?? []);
      return panels.find((p: any) => p.label === "Languages")?.status;
    }, { timeout: 5_000 })
    .toBe("removed");
});
