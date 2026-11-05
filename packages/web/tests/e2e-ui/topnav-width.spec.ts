/**
 * Top navigation width tiers (UX2', sidecar.css).
 *
 * With `web.sidecar` on, the bar carries the logo, project context, four stage
 * tabs, Live, guide, run control, search and the Sidecar button. `.topnav-tabs`
 * is `overflow-x: auto`, so a bar that is too wide does not overflow the page —
 * it silently scrolls its tabs and clips Tune or Live. This spec measures the
 * settled bar at each tier boundary, and at 1100 px with a 40-character project
 * name: nothing scrolls, the project name stays out of the tabs, and the
 * Sidecar button is the last control and sits inside the viewport.
 *
 * If it fails, shed more optional text in a sidecar.css tier (a label, a
 * glyph, padding) and update the tier list there and in top-nav.ts.
 */

import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
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
const LONG_NAME = "acme-warehouse-management-platform-core1"; // 40 characters

/** A fixture with the Sidecar on; `name` sets the project name through package.json. */
async function sidecarProject(name?: string): Promise<{ fixture: FixtureProject; dashboard: RunningDashboard }> {
  const fixture = await createFixtureProject();
  // The Sidecar button renders only while the `web.sidecar` toggle is on;
  // toggles live under `features` in the project config.
  execFileSync("node", [CORE_CLI, "config", "features.web.sidecar", "true", fixture.dir], { stdio: "pipe" });
  if (name) await writeFile(join(fixture.dir, "package.json"), JSON.stringify({ name, private: true }) + "\n");
  return { fixture, dashboard: await startDashboard(fixture.dir) };
}

/** Open Work at `width` and wait for the bar to settle. */
async function openSettledBar(page: Page, baseUrl: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });

  await expect(page.locator(".topnav-sidecar")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.topnav-tab[data-stage="tune"]')).toBeVisible();
  // Measure the settled bar: the branch chip and the run control fill in
  // after their fetches, and each widens the bar.
  await expect(page.locator('.topnav [aria-label^="Branch:"]')).toBeVisible();
  await expect(page.locator('.topnav-run [aria-label^="Run project"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function expectBarFits(page: Page, baseUrl: string, width: number): Promise<void> {
  await openSettledBar(page, baseUrl, width);

  const m = await page.evaluate(() => {
    const nav = document.querySelector(".topnav") as HTMLElement;
    const tabs = document.querySelector(".topnav-tabs") as HTMLElement;
    const button = document.querySelector(".topnav-sidecar") as HTMLElement;
    const project = document.querySelector(".project-context .breadcrumb-project") as HTMLElement;
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
      projectRight: project.getBoundingClientRect().right,
      tabsLeft: tabsRect.left,
      tabsRight: tabsRect.right,
      viewport: window.innerWidth,
    };
  });

  const at = JSON.stringify(m);
  expect(m.navScroll, `topnav scrolls horizontally: ${at}`).toBeLessThanOrEqual(m.navClient);
  expect(m.tabsScroll, `topnav-tabs scrolls horizontally, so Tune or Live is clipped: ${at}`).toBeLessThanOrEqual(m.tabsClient);
  expect(m.tuneRight).toBeLessThanOrEqual(m.tabsRight);
  expect(m.liveRight).toBeLessThanOrEqual(m.tabsRight);
  expect(m.projectRight, `project name runs into the tabs: ${at}`).toBeLessThanOrEqual(m.tabsLeft);
  expect(m.lastIsSidecar, "Sidecar button is the last control").toBe(true);
  expect(m.buttonLeft).toBeGreaterThanOrEqual(0);
  expect(m.buttonRight).toBeLessThanOrEqual(m.viewport);
}

test.describe("short project name", () => {
  let fixture: FixtureProject;
  let dashboard: RunningDashboard;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ({ fixture, dashboard } = await sidecarProject());
  });

  test.afterAll(async () => {
    stopDashboard(dashboard.proc);
    await cleanupFixtureProject(fixture.dir);
  });

  for (const width of WIDTHS) {
    test(`top nav fits at ${width}px with Tune and the Sidecar button`, async ({ page }) => {
      await expectBarFits(page, dashboard.baseUrl, width);
    });
  }

  // Badges the fixture cannot produce (an open Inbox count, a running Live
  // count) can outgrow a tier's spare room. Then the tabs scroll as a last
  // resort; the page must not widen and push the Sidecar button off screen.
  for (const width of [961, 769]) {
    test(`with badges at ${width}px the page does not widen`, async ({ page }) => {
      await openSettledBar(page, dashboard.baseUrl, width);
      const m = await page.evaluate(() => {
        const badge = (host: Element | null, cls: string, text: string) => {
          const el = document.createElement("span");
          el.className = cls;
          el.textContent = text;
          host!.appendChild(el);
        };
        badge(document.querySelector('.topnav-tab[data-stage="plan"]'), "topnav-tab-count", "12");
        badge(document.querySelector(".topnav-tab-live"), "live-count", "2");
        return {
          page: document.documentElement.scrollWidth - window.innerWidth,
          sidecarRight: document.querySelector(".topnav-sidecar")!.getBoundingClientRect().right,
          viewport: window.innerWidth,
        };
      });
      expect(m.page, JSON.stringify(m)).toBeLessThanOrEqual(0);
      expect(m.sidecarRight).toBeLessThanOrEqual(m.viewport);
    });
  }
});

test.describe("40-character project name", () => {
  let fixture: FixtureProject;
  let dashboard: RunningDashboard;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ({ fixture, dashboard } = await sidecarProject(LONG_NAME));
  });

  test.afterAll(async () => {
    stopDashboard(dashboard.proc);
    await cleanupFixtureProject(fixture.dir);
  });

  test("top nav fits at 1100px; the project name gives way, not the tabs", async ({ page }) => {
    expect(LONG_NAME).toHaveLength(40);
    await expectBarFits(page, dashboard.baseUrl, 1100);
    // The full name stays reachable on the trigger while its text is cut.
    await expect(page.locator(".project-context .breadcrumb-project")).toHaveAttribute("title", LONG_NAME);
  });
});
