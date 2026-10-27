/**
 * Settings-overlay helpers for the happy-click specs.
 *
 * The overlay's pages share a `SettingsFrame` whose leave guard blocks any
 * navigation while edits are unsaved. Every scripted test that edits a
 * field must either Save or Discard before it moves on, or the next step
 * meets the guard instead of the page it asked for.
 */

import { expect, type Locator, type Page } from "@playwright/test";

export const SETTINGS_PAGES = ["Robot Wrangler", "Project", "Workflow", "Commands"] as const;
export type SettingsPage = (typeof SETTINGS_PAGES)[number];

export function settingsOverlay(page: Page): Locator {
  return page.getByRole("dialog", { name: "Settings" });
}

/** Open the overlay from the bottom bar and switch to `pageLabel`. */
export async function openSettings(page: Page, pageLabel: SettingsPage): Promise<Locator> {
  const overlay = settingsOverlay(page);
  if (!(await overlay.count())) {
    await page.locator(".bottombar-settings").click();
    await expect(overlay).toBeVisible();
  }
  await overlay.locator(".settings-overlay-item", { hasText: pageLabel }).click();
  await expect(overlay.locator(".settings-overlay-item.active")).toHaveText(new RegExp(pageLabel));
  return overlay;
}

export function dirtyIndicator(page: Page): Locator {
  return settingsOverlay(page).locator(".settings-frame-indicator");
}

/** Press Discard when the frame reports unsaved changes. */
export async function discardIfDirty(page: Page): Promise<void> {
  const discard = settingsOverlay(page).locator("button.settings-frame-discard");
  if ((await discard.count()) && (await discard.isEnabled())) {
    await discard.click();
    await expect(dirtyIndicator(page)).toHaveText("All changes saved");
  }
}

export async function saveAndExpectClean(page: Page): Promise<void> {
  const save = settingsOverlay(page).locator("button.settings-frame-save");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dirtyIndicator(page)).toHaveText("All changes saved", { timeout: 15_000 });
}

export async function closeSettings(page: Page): Promise<void> {
  await discardIfDirty(page);
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(settingsOverlay(page)).toHaveCount(0);
}
