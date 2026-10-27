/**
 * Happy-click: the SourceVision pages.
 *
 * Overview, Repository Map, Zones, Isometric Map, Files, Routes, the three
 * enrichment-gated views, PR Markdown and Ask. The fixture has a `--fast`
 * analysis, so Architecture / Problems / Suggestions show the enrichment
 * gate (asserted, never unlocked — that spawns an LLM pass), and Ask's
 * intended outcome against the dead local vendor is its failure card.
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
  if (!res.ok) throw new Error(`Failed to enable feature toggles: ${res.status}`);
});

test.afterAll(async () => {
  await stopDashboardAndWait(dashboard.proc);
  await cleanupFixtureProject(fixture.dir);
});

async function gotoView(page: Page, path: string): Promise<void> {
  await page.goto(`${dashboard.baseUrl}/${path}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('nav[aria-label="View navigation"]')).toHaveCount(1, { timeout: 10_000 });
}

test("overview: re-analyze completes, the iso hero and zone links work", async ({ page }) => {
  test.setTimeout(60_000);
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "overview");

  // Quick structural re-analyze is synchronous and LLM-free: it must come back "✓ Done".
  const deep = page.locator(".overview-deep-toggle input[type=checkbox]");
  if (await deep.count()) {
    await deep.check();
    await expect(deep).toBeChecked();
    await deep.uncheck();
  }
  const reanalyze = page.getByRole("button", { name: "Re-analyze" }).first();
  await expect(reanalyze).toBeEnabled({ timeout: 10_000 });
  await reanalyze.click();
  await expect(page.locator(".cmd-inline-result-ok").first()).toContainText("Done", { timeout: 30_000 });

  // Isometric hero: Rebuild re-renders the frame, Expand toggles, Options deep-links.
  const hero = page.locator(".iso-hero-frame");
  if (await hero.count()) {
    const heroBtn = (text: string) => page.getByRole("button", { name: text, exact: true });
    await heroBtn("Rebuild").click();
    await expect(hero).toBeVisible({ timeout: 15_000 });
    await heroBtn("Expand").click();
    await expect(heroBtn("Close")).toBeVisible();
    await heroBtn("Close").click();
    await expect(heroBtn("Expand")).toBeVisible();
    if (await heroBtn("Options").count()) {
      await heroBtn("Options").click();
      await expect(page).toHaveURL(/\/iso-map$/);
      await gotoView(page, "overview");
    }
  }

  const nextSteps = page.locator("details.overview-next-steps > summary");
  if (await nextSteps.count()) {
    await nextSteps.click();
    await expect(page.locator("details.overview-next-steps")).toHaveAttribute("open", "");
  }

  const openMap = page.getByRole("button", { name: "Open map →" });
  if (await openMap.count()) {
    await openMap.click();
    await expect(page).toHaveURL(/\/graph$/);
    await gotoView(page, "overview");
  }
  const zone = page.locator(".top-zone-item").first();
  if (await zone.count()) {
    await zone.click();
    // The map lives inside the Analysis stage, so a zone tile may land on /analyze with the map section shown.
    await expect(page).toHaveURL(/\/(graph|analyze)$/);
    await expect(page).not.toHaveURL(/\/overview$/);
  }
  expect(tracker.errors).toEqual([]);
});

test("repository map: display mode toggles, history buttons start disabled", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "graph");
  const toggle = page.locator(".ig-dep-view-toggle .zone-view-btn, .zone-view-btn");
  if (await toggle.count()) {
    await page.getByRole("button", { name: "Switch to table view" }).click();
    await expect(page.locator(".ig-table-section")).toHaveCount(1);
    await page.getByRole("button", { name: "Switch to graph view" }).click();
    await expect(page.locator(".ig-table-section")).toHaveCount(0);
  }
  const chips = page.locator("button.ig-mini-zone");
  if (await chips.count()) {
    await chips.first().click();
    await expect(chips.first()).toHaveClass(/ig-mini-zone-active/);
  }
  for (const btn of await page.locator("button.ig-preview-history-btn").all()) {
    await expect(btn).toBeDisabled();
  }
  expect(tracker.errors).toEqual([]);
});

test("zones: table mode persists, a row opens the slideout, its links navigate", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "zones");
  await page.getByRole("button", { name: "Switch to table view" }).click();
  await expect(page.locator("table.zone-table")).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("table.zone-table")).toBeVisible({ timeout: 10_000 });

  const row = page.locator("tr.zone-table-row").first();
  await expect(row).toBeVisible();
  await row.click();
  const slideout = page.locator("aside.zone-slideout");
  await expect(slideout).toBeVisible();
  const filesToggle = slideout.locator("button.zone-slideout-files-toggle");
  if (await filesToggle.count()) {
    await filesToggle.click();
    await expect(filesToggle).toHaveAttribute("aria-expanded", "true");
  }
  await page.keyboard.press("Escape");
  await expect(slideout).toHaveCount(0);

  await row.click();
  await expect(slideout).toBeVisible();
  await slideout.getByRole("button", { name: "View in Files" }).click();
  await expect(page).toHaveURL(/\/files/);

  await gotoView(page, "zones");
  await page.getByRole("button", { name: "Switch to graph view" }).click();
  for (const name of ["Zoom in", "Zoom out", "Fit to content"]) {
    const btn = page.getByRole("button", { name });
    if (await btn.count()) await btn.click();
  }
  expect(tracker.errors).toEqual([]);
});

test("isometric map: the form builds a map or reports there is nothing to map", async ({ page }) => {
  test.setTimeout(60_000);
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "iso-map");
  const maxNodes = page.locator("#iso-map-max-nodes");
  await maxNodes.fill("50");
  await expect(maxNodes).toHaveValue("50");
  const externals = page.locator("#iso-map-externals");
  if (await externals.count()) await externals.check();
  await page.locator("form.iso-map-controls button[type=submit]").click();
  await expect(page.locator("iframe.iso-map-frame, .iso-map-error").first()).toBeVisible({ timeout: 30_000 });
  expect(tracker.errors).toEqual([]);
});

test("files: search, filters, sort, detail panel and the archetype editor", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "files");
  const count = page.locator(".filter-result-count");
  await expect(count).toBeVisible({ timeout: 10_000 });
  await expect(count).toContainText(/Showing [1-9]\d* of/);

  // The fixture has no internal files for the toggle to reveal, so assert its pressed state, not the count.
  const showAll = page.getByRole("button", { name: /All Files/ });
  const pressed = await showAll.getAttribute("aria-pressed");
  await showAll.click();
  await expect(showAll).toHaveAttribute("aria-pressed", pressed === "true" ? "false" : "true");

  const combobox = page.getByRole("combobox", { name: "Search files" });
  await combobox.fill("greet");
  await expect(page.locator("#file-search-listbox [role=option]").first()).toBeVisible();
  await combobox.fill("");

  for (const select of await page.locator("select.filter-select, select[aria-label='Filter by zone']").all()) {
    const options = await select.locator("option").count();
    if (options > 1) {
      await select.selectOption({ index: 1 });
      await select.selectOption({ index: 0 });
    }
  }

  const header = page.locator("table.data-table th").first();
  const headerText = (await header.textContent()) ?? "";
  await header.click();
  await expect(header).not.toHaveText(headerText);

  await page.locator("table.data-table tbody tr").first().click();
  const close = page.getByRole("button", { name: "Close detail panel" });
  await expect(close).toBeVisible();
  const editArchetype = page.locator("button.archetype-edit-btn").first();
  if (await editArchetype.count()) {
    await editArchetype.click();
    await expect(page.locator("select.archetype-select").first()).toBeVisible(); // not changed: it writes .n-dx.json
  }
  await close.click();
  await expect(close).toHaveCount(0);

  const more = page.locator("button.collapsible-toggle");
  if (await more.count()) await more.first().click();
  expect(tracker.errors).toEqual([]);
});

test("routes: either the route tree with its collapsibles or the locked empty state", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "routes");
  // A plain Node fixture has no routes: the view still mounts (header or locked state) without errors.
  await expect(page.locator("main .view-header, main .locked-view").first()).toBeAttached({ timeout: 10_000 });
  const search = page.locator('main [role="search"] input.filter-input');
  if (await search.count()) {
    await search.fill("zzz");
    await search.fill("");
  }
  const headers = page.locator("button.collapsible-header");
  if (await headers.count()) {
    const first = headers.first();
    const was = await first.getAttribute("aria-expanded");
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", was === "true" ? "false" : "true");
  }
  expect(tracker.errors).toEqual([]);
});

for (const view of ["architecture", "problems", "suggestions"] as const) {
  test(`${view}: the enrichment gate offers unlock buttons on a fast analysis`, async ({ page }) => {
    const tracker = trackConsoleErrors(page);
    await gotoView(page, view);
    await expect(page.locator("button.enrichment-gate-unlock")).toBeEnabled({ timeout: 10_000 });
    await expect(page.locator("button.enrichment-gate-full")).toBeEnabled();
    expect(tracker.errors).toEqual([]);
  });
}

test("pr markdown: preview/raw tabs switch and the choice persists for the session", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "pr-markdown");
  const raw = page.locator("#pr-markdown-tab-raw");
  const preview = page.locator("#pr-markdown-tab-preview");
  await expect(raw.or(page.locator(".pr-markdown-empty")).first()).toBeVisible({ timeout: 10_000 });
  if (await raw.count()) {
    await raw.click();
    await expect(raw).toHaveAttribute("aria-selected", "true");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#pr-markdown-tab-raw")).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });
    await preview.click();
    await expect(preview).toHaveAttribute("aria-selected", "true");
  }
  expect(tracker.errors).toEqual([]);
});

test("ask: submitting a question against the dead vendor shows the failure card", async ({ page }) => {
  const tracker = trackConsoleErrors(page);
  await gotoView(page, "ask");
  const prompt = page.locator("#sv-ask-prompt");
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  const refine = page.locator("#sv-ask-refine-mode");
  if (await refine.count()) {
    await refine.check();
    await expect(refine).toBeChecked();
    await refine.uncheck();
  }
  await prompt.fill("Which zones are most coupled?");
  await page.locator("button.sv-ask-submit").click();
  await expect(page.locator(".sv-ask-error")).toBeVisible({ timeout: 60_000 });
  expect(tracker.errors.filter((e) => !/status of 5\d\d|status of 4\d\d/.test(e))).toEqual([]);
});
