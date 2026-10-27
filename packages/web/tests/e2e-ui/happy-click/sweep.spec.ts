/**
 * Happy-click sweep — every view, every safe control, once.
 *
 * The broad net under the scripted happy-click specs: deep-link each view,
 * press each control the click policy allows, and require that nothing
 * throws and the shell stays mounted. The clicked/skipped lists are attached
 * to the report so a reviewer can see what the sweep reached and why it
 * left the rest alone.
 *
 * Settings views are excluded: their pages sit behind a leave guard and are
 * covered control by control in settings.spec.ts.
 */

import { test, expect } from "@playwright/test";
import {
  createFixtureProject,
  cleanupFixtureProject,
  startDashboard,
  stopDashboardAndWait,
  type FixtureProject,
  type RunningDashboard,
} from "../helpers/fixture-project.js";
import { trackConsoleErrors } from "../helpers/console-errors.js";
import { VIEW_META } from "../../../src/viewer/views/view-meta.js";
import { clickSweep } from "./helpers/sweep.js";

const SETTINGS_VIEWS = new Set(["robot-wrangler", "project", "workflow", "commands"]);
const VIEWS = Object.keys(VIEW_META).filter((v) => !SETTINGS_VIEWS.has(v));

let fixture: FixtureProject;
let dashboard: RunningDashboard;

test.beforeAll(async () => {
  fixture = await createFixtureProject({ sources: true });
  dashboard = await startDashboard(fixture.dir);
  const res = await fetch(`${dashboard.baseUrl}/api/features`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes: { "sourcevision.prMarkdown": true, "sourcevision.ask": true } }),
  });
  if (!res.ok) throw new Error(`Failed to enable feature toggles for the sweep: ${res.status}`);
});

test.afterAll(async () => {
  await stopDashboardAndWait(dashboard.proc);
  await cleanupFixtureProject(fixture.dir);
});

for (const view of VIEWS) {
  test(`view "${view}" survives a click sweep`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const tracker = trackConsoleErrors(page);
    const url = `${dashboard.baseUrl}/${view}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(page.locator('nav[aria-label="View navigation"]')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(500); // let the first data fetches land so the controls exist

    const report = await clickSweep(page, { returnTo: url });
    await testInfo.attach("sweep.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });

    expect(tracker.errors, `console/page errors sweeping /${view}`).toEqual([]);
  });
}
