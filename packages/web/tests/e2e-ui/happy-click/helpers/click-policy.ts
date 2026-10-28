/**
 * What a happy-click sweep must never press.
 *
 * The automated UI fixture is LLM-free (local vendor on a dead port) and
 * disposable, but a click can still start a long process, spend tokens
 * through the vendor, destroy fixture state the rest of the spec relies on,
 * or leave the page (new tab, clipboard, OS dialogs). Those controls are
 * listed here by accessible name or class and exercised only by scripted
 * tests that know what to assert — or not at all.
 *
 * When you add a control that spawns, spends, destroys or leaves, add it
 * here in the same change.
 */

import type { Locator } from "@playwright/test";

/** Accessible-name patterns (case-insensitive, matched against the trimmed name). */
export const DENY_NAME: RegExp[] = [
  // Spawns a long process or needs the vendor.
  /^start now/i,
  /^execute$/i,
  /^resume$/i,
  /^start (epic-by-epic|working)/i,
  /self-heal/i,
  /^run ci check/i,
  /reshape/i,
  /^full analysis/i,
  /^run full analysis/i,
  /^unlock /i,
  /^run analysis \(deep\)/i,
  /^refresh recommendations/i,
  /^generate proposals/i,
  /^process/i,
  /^validate token reporting/i,
  /^refresh data/i,
  /^export (dashboard|& deploy|pdf)/i,
  /sample app/i,
  /^re-analyze/i,
  /^run analysis/i,
  /^status check$/i,
  /^re-check$/i,
  /^re-run .* auth/i,
  /^refresh models/i,
  /^preview & apply/i,
  /^rebuild$/i,
  // Writes that are destructive or irreversible inside one spec.
  /^apply/i,
  /^restore/i,
  /^prune/i,
  /^delete/i,
  /^remove/i,
  /^discard/i,
  /^stage all/i,
  /^ignore$/i,
  /^trust this configuration/i,
  /^stop/i,
  /^end /i,
  /^mark stuck/i,
  /^terminate/i,
  /^dismiss$/i,
  /^lock key/i,
  /^unlock$/i,
  /^migrate the prd tree/i,
  /^confirm/i,
  /^save/i,
  /^set failing/i,
  /^i understand/i,
  /^clear all$/i,
  // Leaves the page or the browser sandbox.
  /^copy/i,
  /^download/i,
  /new tab/i,
  /^notify me/i,
  /^browse/i,
  /^how to install/i,
  /^refresh data now/i,
];

/** Class fragments that mark a control as off-limits regardless of its name. */
export const DENY_CLASS: string[] = [
  "cmd-btn-danger",
  "cmd-btn-confirm",
  "btn-danger",
  "throttle-",
  "git-",
  "enrichment-gate-",
  "settings-frame-save",
  "prune-confirmation-btn-prune",
  "rex-analyze-btn-run",
  "smart-add-btn-generate",
  "smart-add-btn-accept",
  "batch-import-process-btn",
  "batch-import-browse-btn",
  "exec-panel-",
  "hench-template-apply-btn",
  "hench-template-delete-btn",
  "llm-profile-del",
  "audit-btn-terminate",
  "live-stop",
  "live-end-dead",
  "active-op-stop",
  "ready-primary",
  "start-task-primary",
  "start-task-migrate-btn",
  "prep-btn",
  "workspace-card-stop",
  "iso-hero-btn",
  // Sidecar: a turn runs the vendor CLI and spends tokens.
  "sidecar-send",
  // Sidecar cards: approving lets the agent act; "always allow" writes the allow-list.
  "sidecar-card-approve",
  "sidecar-card-always",
];

export interface ControlIdentity {
  name: string;
  classes: string;
}

export async function identify(locator: Locator): Promise<ControlIdentity> {
  const [name, classes] = await Promise.all([
    locator.evaluate((el) => {
      const e = el as HTMLElement;
      return (e.getAttribute("aria-label") ?? e.textContent ?? "").replace(/\s+/g, " ").trim();
    }),
    locator.evaluate((el) => (el as HTMLElement).className ?? ""),
  ]);
  return { name, classes: typeof classes === "string" ? classes : "" };
}

export function isDenied(id: ControlIdentity): string | null {
  for (const re of DENY_NAME) if (re.test(id.name)) return `name ~ ${re}`;
  for (const fragment of DENY_CLASS) if (id.classes.includes(fragment)) return `class ~ ${fragment}`;
  return null;
}
