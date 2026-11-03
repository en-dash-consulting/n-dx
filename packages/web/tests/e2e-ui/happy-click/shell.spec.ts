/**
 * Happy-click: the shell chrome, Home and the three stage pages.
 *
 * Top-nav tabs, the Home stage cards, the previous/next stage links, every
 * stage section's expand/tab/open controls, the bottom bar (commands sheet,
 * settings, theme), the FAQ, the search overlay, the page guide and the
 * Live peek. Each click is followed by the assertion that says it worked:
 * a URL, an `aria-*` state, a mounted element, a persisted preference.
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

const STAGES = ["analyze", "plan", "work"] as const;
const STAGE_LABEL: Record<(typeof STAGES)[number], string> = { analyze: "Analysis", plan: "Plan", work: "Work" };

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

test("top-nav tabs and the brand switch stages and Home", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "home");
  for (const stage of STAGES) {
    await page.locator(`button.topnav-tab[data-stage="${stage}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${stage}$`));
    await expect(page.locator(".topnav-tab.active .topnav-tab-label")).toHaveText(STAGE_LABEL[stage]);
    await expect(page.locator(`main .stage-page[data-stage="${stage}"]`)).toHaveCount(1);
  }
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator(".stage-card")).toHaveCount(3);
  expect(tracker.errors).toEqual([]);
});

test("Home stage cards open their stage", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  for (const stage of STAGES) {
    await gotoView(page, "home");
    await page.locator(`button.stage-card[data-stage="${stage}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${stage}$`));
    await expect(page.locator(`main .stage-page[data-stage="${stage}"]`)).toHaveCount(1);
  }
  expect(tracker.errors).toEqual([]);
});

test("previous/next stage links step and wrap through the three stages", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "analyze");
  const order = ["plan", "work", "analyze"];
  for (const next of order) {
    await page.locator("button.stage-link-next").click();
    await expect(page).toHaveURL(new RegExp(`/${next}$`));
  }
  await page.locator("button.stage-link-prev").click();
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.locator("button.stage-link-prev")).toHaveAttribute("aria-label", "Previous stage: Plan");
  expect(tracker.errors).toEqual([]);
});

for (const stage of STAGES) {
  test(`${stage} stage: every section expands, tabs switch, Open deep-links`, async ({ page }) => {
    test.setTimeout(60_000);
    const tracker = trackConsoleErrors(page);
    await gotoView(page, stage);

    const sections = page.locator("main section.stage-section:not(.stage-section--plain)");
    await expect(sections.first()).toBeVisible({ timeout: 10_000 });
    const count = await sections.count();
    expect(count, `${stage} should have collapsible sections`).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const section = sections.nth(i);
      const view = (await section.getAttribute("data-view")) ?? "";
      const toggle = section.locator("button.stage-section-toggle");
      const wasOpen = (await toggle.getAttribute("aria-expanded")) === "true";

      // Expand (or collapse-then-expand) so the body, tabs and Open exist.
      if (!wasOpen) await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(section.locator(".stage-section-body")).toHaveCount(1);

      const tabs = section.locator('[role="tab"]');
      for (let t = 0; t < (await tabs.count()); t++) {
        await tabs.nth(t).click();
        await expect(tabs.nth(t)).toHaveAttribute("aria-selected", "true");
      }

      const expand = section.locator("button.stage-section-expand");
      if (await expand.count()) {
        await expand.click();
        await expect(expand).toHaveAttribute("aria-expanded", "true");
        await expand.click();
        await expect(expand).toHaveAttribute("aria-expanded", "false");
      }

      // Collapse and check the preference survives a reload.
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await page.reload({ waitUntil: "domcontentloaded" });
      const after = page.locator(`main section.stage-section[data-view="${view}"] button.stage-section-toggle`);
      await expect(after).toHaveAttribute("aria-expanded", "false", { timeout: 10_000 });
      await after.click();
      await expect(after).toHaveAttribute("aria-expanded", "true");

      // Open ↗ deep-links to the section's current view, which is a real route.
      const open = page.locator(`main section.stage-section[data-view="${view}"] button.stage-section-open`);
      const label = (await open.getAttribute("aria-label")) ?? "";
      await open.click();
      await expect(page).not.toHaveURL(new RegExp(`/${stage}$`));
      expect(label).toMatch(/^Open .* on its own page$/);
      await gotoView(page, stage);
    }
    expect(tracker.errors).toEqual([]);
  });
}

test("bottom bar: commands sheet, settings overlay, theme toggle persists", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "work");

  const commands = page.locator(".bottombar-commands");
  await commands.click();
  await expect(page.locator("#commands-sheet")).toBeVisible();
  await expect(commands).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Close commands" }).click();
  await expect(page.locator("#commands-sheet")).toBeHidden();

  await page.locator(".bottombar-settings").click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/work$/);

  const theme = page.getByRole("group", { name: "Theme" });
  await theme.locator('button[data-theme-pref="dark"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-pref", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(theme.locator('button[data-theme-pref="dark"]')).toHaveAttribute("aria-pressed", "true");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme-pref", "dark", { timeout: 10_000 });
  await theme.locator('button[data-theme-pref="system"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-pref", "system");
  expect(tracker.errors).toEqual([]);
});

test("FAQ opens, sections expand one at a time, and it closes", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "plan");
  await page.getByRole("button", { name: "Open help and FAQ" }).click();
  const faq = page.getByRole("dialog", { name: "Help and FAQ" });
  await expect(faq).toBeVisible();
  const headers = faq.locator("button.faq-section-header");
  const n = await headers.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await headers.nth(i).click();
    await expect(headers.nth(i)).toHaveAttribute("aria-expanded", "true");
    await expect(faq.locator(".faq-section-items")).toHaveCount(1);
  }
  await faq.getByRole("button", { name: "Close FAQ" }).click();
  await expect(faq).toHaveCount(0);
  expect(tracker.errors).toEqual([]);
});

test("search overlay finds the fixture task and opens it in Tasks", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "analyze");
  await page.getByRole("button", { name: "Search files, zones and tasks" }).click();
  const input = page.locator("input.search-overlay-input");
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill("E2E Fixture Task");
  const result = page.getByRole("option", { name: /E2E Fixture Task/ }).first();
  await expect(result).toBeVisible({ timeout: 10_000 });
  await result.click();
  await expect(page).toHaveURL(/\/prd/);
  expect(tracker.errors).toEqual([]);
});

test("the page guide opens and closes", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "prd");
  await page.getByRole("button", { name: "View guide for this page" }).click();
  const guide = page.getByRole("dialog", { name: /^Guide: / });
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Close guide" }).click();
  await expect(guide).toHaveCount(0);
  expect(tracker.errors).toEqual([]);
});

test("the Live tab peeks on hover and navigates on click", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "analyze");
  const liveTab = page.locator("button.topnav-tab-live");
  await liveTab.hover();
  await expect(page.locator("#live-peek")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await liveTab.click();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.locator('nav[aria-label="Running now"]')).toHaveCount(1);
  expect(tracker.errors).toEqual([]);
});


test("top bar preserves brand and project at intermediate widths", async ({ page }) => {
  await gotoView(page, "home");
  await page.locator(".breadcrumb-project").evaluate((el) => { el.textContent = "A particularly long project name for layout coverage"; });
  for (const width of [1024, 1150, 1280, 1400]) {
    await page.setViewportSize({ width, height: 900 });
    const sizes = await page.evaluate(() => ({
      bar: document.querySelector(".topnav")!.getBoundingClientRect().width,
      brand: document.querySelector(".topnav-brand")!.getBoundingClientRect().width,
      project: document.querySelector(".project-context")!.getBoundingClientRect().width,
      page: document.documentElement.scrollWidth,
    }));
    expect(sizes.bar).toBeLessThanOrEqual(width);
    expect(sizes.page).toBeLessThanOrEqual(width);
    expect(sizes.brand).toBeGreaterThanOrEqual(100);
    expect(sizes.project).toBeGreaterThanOrEqual(100);
  }
});


test("floating notices and expanded panels share vertical space at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoView(page, "home");
  await page.locator(".status-dock").evaluate((stack) => {
    stack.replaceChildren();
    for (const className of ["refresh-toast", "rex-toast", "audit-toast", "wf-toast", "hench-template-toast", "polling-suspension-indicator"]) {
      const notice = document.createElement("div");
      notice.className = className;
      notice.textContent = "A status message with enough text to wrap on a narrow screen";
      stack.append(notice);
    }
    const tray = document.createElement("div");
    tray.className = "sessions-panel";
    tray.innerHTML = '<button class="sessions-toggle">Sessions</button><ul class="sessions-list"><li>Running a task</li></ul>';
    stack.append(tray);
  });
  const boxes = await page.locator(".status-dock > *").evaluateAll((items) => items.map((item) => {
    const rect = item.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  }));
  for (let i = 0; i < boxes.length; i++) {
    expect(boxes[i]!.left).toBeGreaterThanOrEqual(0);
    expect(boxes[i]!.right).toBeLessThanOrEqual(390);
    expect(boxes[i]!.bottom).toBeLessThan(804);
    if (i > 0) expect(boxes[i]!.bottom).toBeLessThanOrEqual(boxes[i - 1]!.top);
  }
});
