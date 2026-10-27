/**
 * Work page lead section — Epic Progress layout.
 *
 * Regression coverage for the Work page's dead space: the dashboard laid Up
 * Next and Epic Progress in a left column beside a taller sidebar, so the
 * left column ended early and left an empty stretch above Execution Log.
 * Epic Progress is now a dropdown of blocks under the panels: its rows must
 * be visible, share rows, close and stay closed, and the next stage section
 * must start right below it.
 */

import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  createFixtureProject,
  cleanupFixtureProject,
  startDashboard,
  stopDashboard,
  REX_BIN,
  type FixtureProject,
  type RunningDashboard,
} from "./helpers/fixture-project.js";
import { trackConsoleErrors } from "./helpers/console-errors.js";

// Enough epics to fill the bounded list and wrap the block grid.
const EXTRA_EPICS = 12;

let fixture: FixtureProject;
let dashboard: RunningDashboard;

// One fixture for the file: twelve `rex add` spawns are too slow to repeat per worker.
test.describe.configure({ mode: "default" });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  fixture = await createFixtureProject();
  for (let i = 1; i <= EXTRA_EPICS; i += 1) {
    execFileSync("node", [REX_BIN, "add", "epic", `--title=Layout Epic ${i}`, fixture.dir], { stdio: "pipe" });
  }
  dashboard = await startDashboard(fixture.dir);
});

test.afterAll(async () => {
  stopDashboard(dashboard.proc);
  await cleanupFixtureProject(fixture.dir);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`epic rows are visible blocks with no gap below them (${colorScheme})`, async ({ page }) => {
    const tracker = trackConsoleErrors(page);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.emulateMedia({ colorScheme });
    await page.goto(`${dashboard.baseUrl}/work`, { waitUntil: "domcontentloaded" });

    const epics = page.locator(".rex-dash-epics");
    const rows = page.locator(".rex-dash-epic");
    // Closed by default: open it.
    await page.locator(".rex-dash-epics-head").click({ timeout: 15_000 });
    await expect(rows).toHaveCount(EXTRA_EPICS + 1, { timeout: 15_000 });
    // Never behind the scroll reveal: a reveal that did not fire in a real
    // browser left the section transparent, which this fixture never caught.
    await expect(epics).not.toHaveClass(/section-reveal/);
    await epics.scrollIntoViewIfNeeded();

    // Visible: the section has revealed and the first rows carry their titles.
    await expect(epics).toHaveCSS("opacity", "1");
    for (let i = 0; i < 3; i += 1) {
      await expect(rows.nth(i).locator(".rex-task-link-title")).toBeVisible();
      await expect(rows.nth(i).locator(".rex-task-link-title")).not.toHaveText("");
    }

    // Blocks, two to a row: the first two share a row and the third wraps.
    const [first, second, third] = await Promise.all([0, 1, 2].map((i) => rows.nth(i).boundingBox()));
    expect(first && second && Math.abs(first.y - second.y) < 2, "first two epics on one row").toBe(true);
    expect(first && third && third.y > first.y + first.height - 1, "third epic on the next row").toBe(true);

    // No gap: every block of the dashboard has another block directly under
    // it, and the first stage section follows Epic Progress. A row of panels
    // of different heights once left hundreds of pixels blank under the short
    // ones, so this is checked per block, not for the dashboard as a whole.
    const gaps = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll(".rex-dash-next, .rex-dash-panel, .rex-dash-epics")];
      const next = document.querySelector("main section.stage-section:not(.stage-section--plain)");
      const below = next ? [...blocks, next] : blocks;
      return blocks.map((el) => {
        const r = el.getBoundingClientRect();
        const under = below
          .filter((o) => o !== el)
          .map((o) => o.getBoundingClientRect())
          .filter((o) => o.top >= r.bottom - 1 && o.left < r.right && o.right > r.left)
          .map((o) => o.top - r.bottom);
        return { block: el.className.split(" ")[0] + ":" + (el.querySelector("h3")?.textContent ?? ""), gap: Math.min(...under) };
      });
    });
    for (const { block, gap } of gaps) {
      expect(gap, `empty space under ${block}`).toBeLessThan(40);
    }

    expect(tracker.errors).toEqual([]);
  });
}

test("Epic Progress is closed by default and remembers being opened", async ({ page }) => {
  await page.goto(`${dashboard.baseUrl}/work`, { waitUntil: "domcontentloaded" });
  const head = page.locator(".rex-dash-epics-head");
  await expect(head).toHaveAttribute("aria-expanded", "false", { timeout: 15_000 });
  await expect(page.locator(".rex-dash-epic")).toHaveCount(0);

  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#rex-dash-epic-list")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".rex-dash-epics-head")).toHaveAttribute("aria-expanded", "true", { timeout: 15_000 });
  await expect(page.locator("#rex-dash-epic-list")).toBeVisible();

  await page.locator(".rex-dash-epics-head").click();
  await expect(page.locator("#rex-dash-epic-list")).toHaveCount(0);
});

test("Epic Progress filters by name and status", async ({ page }) => {
  await page.goto(`${dashboard.baseUrl}/work`, { waitUntil: "domcontentloaded" });
  await page.locator(".rex-dash-epics-head").click({ timeout: 15_000 });
  const rows = page.locator(".rex-dash-epic");
  await expect(rows).toHaveCount(EXTRA_EPICS + 1);

  await page.getByRole("searchbox", { name: /by name/ }).fill("Layout Epic 1");
  // "Layout Epic 1", "10", "11", "12".
  await expect(rows).toHaveCount(4);
  await page.getByRole("searchbox", { name: /by name/ }).fill("");
  await page.getByRole("combobox", { name: "Status" }).selectOption("completed");
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("match these filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(rows).toHaveCount(EXTRA_EPICS + 1);
});
