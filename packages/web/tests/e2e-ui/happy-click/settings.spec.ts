/**
 * Happy-click: the Settings overlay and its four pages.
 *
 * The overlay's navigation and close, then Robot Wrangler (vendor cards,
 * model select, dirty/discard, the leave guard end to end, the local
 * vendor's connection test against the dead port), Project (the feature
 * toggle round trip: flip → Save → the Ask section appears on the Analysis
 * stage without a reload; zone pins), Workflow (edit/revert, tags, CLI
 * timeouts, template forms) and Commands (the self-heal two-step gate, the
 * export deploy fields). Every edit is discarded or saved before moving on.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  createFixtureProject,
  cleanupFixtureProject,
  startDashboard,
  stopDashboardAndWait,
  type FixtureProject,
  type RunningDashboard,
} from "../helpers/fixture-project.js";
import { trackConsoleErrors } from "../helpers/console-errors.js";
import { openSettings, closeSettings, discardIfDirty, dirtyIndicator, saveAndExpectClean, settingsOverlay } from "./helpers/settings.js";

let fixture: FixtureProject;
let dashboard: RunningDashboard;

test.beforeAll(async () => {
  fixture = await createFixtureProject({ sources: true });
  dashboard = await startDashboard(fixture.dir);
});

test.afterAll(async () => {
  await stopDashboardAndWait(dashboard.proc);
  await cleanupFixtureProject(fixture.dir);
});

async function gotoView(page: Page, path: string): Promise<void> {
  await page.goto(`${dashboard.baseUrl}/${path}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('nav[aria-label="View navigation"]')).toHaveCount(1, { timeout: 10_000 });
}

test("overlay: each page tab routes, density buttons press, the summary expands, close returns", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "work");
  await page.locator(".bottombar-settings").click();
  const overlay = settingsOverlay(page);
  await expect(overlay).toBeVisible();
  for (const [label, path] of [["Project", "project"], ["Workflow", "workflow"], ["Commands", "commands"], ["Robot Wrangler", "robot-wrangler"]] as const) {
    await overlay.locator(".settings-overlay-item", { hasText: label }).click();
    await expect(page).toHaveURL(new RegExp(`/${path}$`));
    await expect(overlay.locator(".settings-overlay-item.active")).toHaveAttribute("aria-current", "page");
  }
  for (const btn of await overlay.locator("button.density-btn").all()) {
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
  }
  const summary = overlay.locator("button.config-footer-toggle");
  if (await summary.count()) {
    await summary.click();
    await expect(summary).toHaveAttribute("aria-expanded", "true");
  }
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page).toHaveURL(/\/work$/);
  expect(tracker.errors).toEqual([]);
});

test("robot wrangler: vendor cards, model select, dirty → discard, and the leave guard", async ({ page }) => {
  test.setTimeout(60_000);
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "work");
  const overlay = await openSettings(page, "Robot Wrangler");

  const cards = overlay.locator('[role="radio"].llm-radio-card');
  await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  const claude = overlay.locator(".llm-vendor-card-claude");
  await claude.click();
  await expect(claude).toHaveAttribute("aria-checked", "true");
  await expect(dirtyIndicator(page)).toHaveClass(/settings-frame-indicator--dirty/);

  const select = overlay.locator("select.llm-select-input").first();
  if (await select.count()) {
    await select.selectOption({ label: "Other model id…" });
    await expect(overlay.getByRole("textbox", { name: / — model id$/ }).first()).toBeVisible();
  }
  for (const chip of await overlay.locator('[role="radio"].llm-review-chip').all()) {
    await chip.click();
    await expect(chip).toHaveAttribute("aria-checked", "true");
  }
  for (const round of await overlay.locator('[role="radio"].llm-review-round').all()) {
    await round.click();
    await expect(round).toHaveAttribute("aria-checked", "true");
  }

  // Leave guard: closing while dirty asks first; "Keep editing" stays, "Discard changes" leaves.
  await page.getByRole("button", { name: "Close settings" }).click();
  const guard = page.locator(".leave-guard-backdrop");
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Keep editing" }).click();
  await expect(guard).toHaveCount(0);
  await expect(overlay).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await guard.getByRole("button", { name: "Discard changes" }).click();
  await expect(overlay).toHaveCount(0);

  // Back in: the discard button itself restores the saved state.
  await openSettings(page, "Robot Wrangler");
  await overlay.locator(".llm-vendor-card-claude").click();
  await expect(dirtyIndicator(page)).toHaveClass(/settings-frame-indicator--dirty/);
  await discardIfDirty(page);
  await expect(overlay.locator(".llm-vendor-card-local")).toHaveAttribute("aria-checked", "true");

  // The local vendor's connection test against the dead port is its intended failure.
  const testConnection = overlay.getByRole("button", { name: "Test connection" });
  if (await testConnection.count()) {
    await testConnection.click();
    await expect(overlay.locator(".llm-smoke-err, .llm-smoke-ok").first()).toBeVisible({ timeout: 30_000 });
  }
  const pill = overlay.locator("button.llm-pill-refresh");
  if (await pill.count()) await pill.click();
  await closeSettings(page);
  expect(tracker.errors.filter((e) => !/status of [45]\d\d/.test(e))).toEqual([]);
});

test("project: a feature toggle saved here unhides the Ask section on the Analysis stage; pins add and remove", async ({ page }) => {
  test.setTimeout(60_000);
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "analyze");
  await expect(page.locator('section.stage-section[data-view="ask"]')).toHaveCount(0);

  const overlay = await openSettings(page, "Project");
  // The input is visually hidden behind its switch label; the label is the click target.
  const askToggle = overlay.getByRole("checkbox", { name: "Toggle Ask Panel" });
  await expect(askToggle).toHaveCount(1, { timeout: 10_000 });
  await expect(askToggle).not.toBeChecked();
  await overlay
    .locator("label.ft-toggle-switch")
    .filter({ has: page.getByRole("checkbox", { name: "Toggle Ask Panel" }) })
    .click();
  await expect(askToggle).toBeChecked();
  await expect(overlay.locator(".ft-badge-unsaved").first()).toBeVisible();
  await saveAndExpectClean(page);
  const features = (await (await fetch(`${dashboard.baseUrl}/api/features`)).json()) as { toggles?: Array<{ key: string; enabled?: boolean; value?: boolean }> } & Record<string, unknown>;
  expect(JSON.stringify(features)).toContain("sourcevision.ask");

  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.locator('section.stage-section[data-view="ask"]')).toHaveCount(1, { timeout: 10_000 });

  await openSettings(page, "Project");
  await overlay.locator("button.ps-pin-add").click();
  const pinPath = overlay.getByRole("textbox", { name: "Pinned file path" }).last();
  await expect(pinPath).toBeVisible();
  await pinPath.fill("src/example.ts");
  await overlay.getByRole("textbox", { name: "Pinned zone ID" }).last().fill("example-zone");
  await expect(dirtyIndicator(page)).toHaveClass(/settings-frame-indicator--dirty/);
  await overlay.getByRole("button", { name: "Remove pin" }).last().click();
  await discardIfDirty(page);

  const threshold = overlay.locator("#ps-merge-threshold");
  await threshold.fill("7");
  await expect(dirtyIndicator(page)).toHaveClass(/settings-frame-indicator--dirty/);
  await closeSettings(page);
  expect(tracker.errors).toEqual([]);
});

test("workflow: edit and revert, tags, CLI timeouts, template details and the save-template form", async ({ page }) => {
  test.setTimeout(60_000);
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "work");
  const overlay = await openSettings(page, "Workflow");

  const link = overlay.locator("button.link-btn", { hasText: "Robot Wrangler" });
  if (await link.count()) {
    await link.click();
    await expect(page).toHaveURL(/\/robot-wrangler$/);
    await openSettings(page, "Workflow");
  }

  const numeric = overlay.locator("input[type=number].hench-config-input").first();
  await expect(numeric).toBeVisible({ timeout: 10_000 });
  const original = await numeric.inputValue();
  await numeric.fill(String(Number(original || "1") + 1));
  await expect(dirtyIndicator(page)).toHaveClass(/settings-frame-indicator--dirty/);
  const revert = overlay.locator("button.hench-config-reset-btn").first();
  if (await revert.count()) {
    await revert.click();
    await expect(numeric).toHaveValue(original);
  }
  await discardIfDirty(page);

  const tagInput = overlay.locator("input.hench-config-tag-input").first();
  if (await tagInput.count()) {
    await tagInput.fill("e2e-tag");
    await overlay.locator("button.hench-config-tag-add-btn").first().click();
    const remove = overlay.getByRole("button", { name: "Remove e2e-tag" });
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(remove).toHaveCount(0);
    await discardIfDirty(page);
  }

  const timeout = overlay.getByRole("spinbutton", { name: /timeout/i }).first();
  if (await timeout.count()) {
    const was = await timeout.inputValue();
    await timeout.fill("12345");
    await expect(dirtyIndicator(page)).toHaveClass(/settings-frame-indicator--dirty/);
    const ctRevert = overlay.locator("button.ct-reset-btn").first();
    if (await ctRevert.count()) {
      await ctRevert.click();
      await expect(timeout).toHaveValue(was);
    }
    await discardIfDirty(page);
  }

  const details = overlay.locator("button.hench-template-expand-btn").first();
  if (await details.count()) {
    await details.click();
    await expect(details).toHaveText("Less");
    await details.click();
  }
  const saveCurrent = overlay.locator("button.hench-template-save-current-btn");
  if (await saveCurrent.count()) {
    await saveCurrent.click();
    const cancel = overlay.locator("button.hench-template-cancel-btn");
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(cancel).toHaveCount(0);
  }
  await closeSettings(page);
  expect(tracker.errors).toEqual([]);
});

test("commands: fast-mode checkbox, the self-heal two-step gate, the export deploy fields", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "work");
  const overlay = await openSettings(page, "Commands");

  const fast = overlay.getByRole("checkbox", { name: /Fast mode/ });
  await expect(fast).toBeVisible({ timeout: 10_000 });
  const wasChecked = await fast.isChecked();
  await fast.click();
  await expect(fast).toBeChecked({ checked: !wasChecked });
  await fast.click();

  const runSelfHeal = overlay.getByRole("button", { name: /^Run Self-Heal/ });
  await expect(runSelfHeal).toHaveCount(0);
  await overlay.getByRole("button", { name: "I understand — proceed" }).click();
  await expect(runSelfHeal).toBeVisible();
  await overlay.getByRole("button", { name: "Cancel", exact: true }).first().click();
  await expect(runSelfHeal).toHaveCount(0);

  const deploy = overlay.getByRole("checkbox", { name: /Deploy to GitHub Pages/ });
  if (await deploy.count()) {
    const inputsBefore = await overlay.locator("input.cmd-panel-input").count();
    await deploy.check();
    await expect(overlay.locator("input.cmd-panel-input")).not.toHaveCount(inputsBefore);
    await deploy.uncheck();
    await expect(overlay.locator("input.cmd-panel-input")).toHaveCount(inputsBefore);
  }
  await closeSettings(page);
  expect(tracker.errors).toEqual([]);
});
