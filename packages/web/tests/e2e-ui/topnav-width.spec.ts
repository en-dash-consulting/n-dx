/**
 * Top navigation width tiers (UX2', sidecar.css).
 *
 * With `web.sidecar` on, the bar carries the logo, project context, four stage
 * tabs, Live, guide, run control, search and the Sidecar button. `.topnav-tabs`
 * is `overflow-x: auto`, so a bar that is too wide does not overflow the page —
 * it silently scrolls its tabs and clips Tune or Live. This spec measures the
 * bar at each tier boundary: nothing scrolls, and the Sidecar button is the
 * last control and sits inside the viewport.
 *
 * If it fails, add the next width step in sidecar.css (hide a glyph or label);
 * do not raise a breakpoint.
 */

import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import {
  createFixtureProject,
  cleanupFixtureProject,
  startDashboard,
  stopDashboard,
  REX_BIN,
  type FixtureProject,
  type RunningDashboard,
} from "./helpers/fixture-project.js";

const WIDTHS = [1440, 1200, 1100, 960] as const;
const CORE_CLI = join(dirname(REX_BIN), "..", "cli.js");

let fixture: FixtureProject;
let dashboard: RunningDashboard;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  fixture = await createFixtureProject();
  // The Sidecar button renders only while the `web.sidecar` toggle is on;
  // toggles live under `features` in the project config.
  execFileSync("node", [CORE_CLI, "config", "features.web.sidecar", "true", fixture.dir], { stdio: "pipe" });
  dashboard = await startDashboard(fixture.dir);
});

test.afterAll(async () => {
  stopDashboard(dashboard.proc);
  await cleanupFixtureProject(fixture.dir);
});

for (const width of WIDTHS) {
  test(`top nav fits at ${width}px with Tune and the Sidecar button`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${dashboard.baseUrl}/work`, { waitUntil: "domcontentloaded" });

    const sidecar = page.locator(".topnav-sidecar");
    await expect(sidecar).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.topnav-tab[data-stage="tune"]')).toBeVisible();
    // Measure the settled bar: the branch chip and the run control fill in
    // after their fetches, and each widens the bar.
    await expect(page.locator('.topnav [aria-label^="Branch:"]')).toBeVisible();
    await expect(page.locator('.topnav-run [aria-label^="Run project"]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const m = await page.evaluate(() => {
      const nav = document.querySelector(".topnav") as HTMLElement;
      const tabs = document.querySelector(".topnav-tabs") as HTMLElement;
      const button = document.querySelector(".topnav-sidecar") as HTMLElement;
      const live = tabs.lastElementChild as HTMLElement;
      const tune = document.querySelector('.topnav-tab[data-stage="tune"]') as HTMLElement;
      const controls = Array.from(nav.children).filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (el as HTMLElement).getAttribute("role") !== "separator";
      });
      const tabsRect = tabs.getBoundingClientRect();
      return {
        navScroll: nav.scrollWidth, navClient: nav.clientWidth,
        tabsScroll: tabs.scrollWidth, tabsClient: tabs.clientWidth,
        buttonRight: button.getBoundingClientRect().right,
        buttonLeft: button.getBoundingClientRect().left,
        lastIsSidecar: controls[controls.length - 1] === button,
        liveRight: live.getBoundingClientRect().right,
        tuneRight: tune.getBoundingClientRect().right,
        tabsRight: tabsRect.right,
        viewport: window.innerWidth,
      };
    });

    const at = JSON.stringify(m);
    expect(m.navScroll, `topnav scrolls horizontally: ${at}`).toBeLessThanOrEqual(m.navClient);
    expect(m.tabsScroll, `topnav-tabs scrolls horizontally, so Tune or Live is clipped: ${at}`).toBeLessThanOrEqual(m.tabsClient);
    expect(m.tuneRight).toBeLessThanOrEqual(m.tabsRight);
    expect(m.liveRight).toBeLessThanOrEqual(m.tabsRight);
    expect(m.lastIsSidecar, "Sidecar button is the last control").toBe(true);
    expect(m.buttonLeft).toBeGreaterThanOrEqual(0);
    expect(m.buttonRight).toBeLessThanOrEqual(m.viewport);
  });
}
