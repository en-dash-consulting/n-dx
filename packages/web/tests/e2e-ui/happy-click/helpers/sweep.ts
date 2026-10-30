/**
 * Generic happy-click sweep: press every safe control on a page once and
 * make sure the page survives it.
 *
 * It re-queries the page before every click (a click can replace the DOM),
 * skips anything the click policy denies, and after each click undoes the
 * obvious side effects so the next control is reachable: an open dialog or
 * menu gets Escape, a navigation goes back to the page under test.
 *
 * The sweep is a net, not a proof — it asserts "no page error, shell still
 * mounted", which catches handlers that throw. What a control is *meant* to
 * do is asserted by the scripted specs beside this helper.
 */

import { expect, type Locator, type Page } from "@playwright/test";
import { identify, isDenied } from "./click-policy.js";

export interface SweepOptions {
  /** CSS scope; defaults to the main content area. */
  root?: string;
  /** Stop after this many clicks, so a page that keeps growing controls terminates. */
  maxClicks?: number;
  /** Where to return after a click navigates away; defaults to the URL at sweep start. */
  returnTo?: string;
}

export interface SweepReport {
  clicked: string[];
  skipped: string[];
}

const CONTROLS = 'button, [role="button"], [role="tab"], [role="radio"], summary';
const NEVER_INSIDE = ["#settings-overlay", ".git-status-chip", ".leave-guard-backdrop"];

async function candidates(page: Page, root: string): Promise<Locator[]> {
  const all = page.locator(root).locator(CONTROLS);
  const count = await all.count();
  const out: Locator[] = [];
  for (let i = 0; i < count; i++) out.push(all.nth(i));
  return out;
}

async function insideForbidden(locator: Locator): Promise<boolean> {
  return locator.evaluate(
    (el, selectors) => selectors.some((s) => (el as HTMLElement).closest(s) !== null),
    NEVER_INSIDE,
  );
}

async function settle(page: Page, returnTo: string): Promise<void> {
  // A navigation away from the page under test: come back.
  if (page.url() !== returnTo) {
    await page.goto(returnTo, { waitUntil: "domcontentloaded" });
    return;
  }
  // Dialogs and menus close on Escape; a leave guard answers "keep editing".
  const dialog = page.locator('[role="dialog"], [role="menu"]');
  if (await dialog.count()) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
  }
}

export async function clickSweep(page: Page, options: SweepOptions = {}): Promise<SweepReport> {
  const root = options.root ?? "main";
  const maxClicks = options.maxClicks ?? 60;
  const returnTo = options.returnTo ?? page.url();
  const seen = new Set<string>();
  const report: SweepReport = { clicked: [], skipped: [] };

  for (let round = 0; report.clicked.length < maxClicks; round++) {
    let progressed = false;
    for (const control of await candidates(page, root)) {
      if (report.clicked.length >= maxClicks) break;
      let id;
      try {
        if (!(await control.isVisible()) || !(await control.isEnabled())) continue;
        if (await insideForbidden(control)) continue;
        id = await identify(control);
      } catch {
        continue; // detached between the query and the check
      }
      const key = `${id.name}|${id.classes}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const why = isDenied(id);
      if (why) {
        report.skipped.push(`${id.name || "(unnamed)"} — ${why}`);
        continue;
      }
      try {
        await control.click({ timeout: 2_000 });
        report.clicked.push(id.name || `(unnamed ${id.classes})`);
        progressed = true;
      } catch (err) {
        report.skipped.push(`${id.name || "(unnamed)"} — not clickable: ${String(err).split("\n")[0]}`);
        continue;
      }
      await settle(page, returnTo);
      await expect(page.locator('nav[aria-label="View navigation"]')).toHaveCount(1);
    }
    if (!progressed || round > 5) break; // nothing new appeared, or a control keeps spawning controls
  }
  return report;
}
