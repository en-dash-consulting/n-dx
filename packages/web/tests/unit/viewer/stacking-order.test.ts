/**
 * The app-level stacking order holds, and is expressed in one place.
 *
 * The bug this pins: `.settings-overlay` sat at a bare `z-index: 60` while the
 * status trays, banners and toasts that render as its siblings in `main.ts`
 * sat anywhere from 100 to 10001. The page below stays mounted when settings
 * opens, so all of that painted straight over the settings page — reported as
 * text from the work page overlaying the PRD settings menu.
 *
 * Raw numbers made that invisible: each component picked its own, and nothing
 * compared them. The scale now lives in `styles/tokens.css` as `--z-*`, and
 * this test reads the real stylesheets to check the order still makes sense.
 *
 * Local stacking inside a single component (a graph node over its edges) is
 * deliberately not part of the scale and is ignored here.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STYLES_DIR = join(import.meta.dirname, "../../../src/viewer/styles");

/** `--z-name` → numeric value, from the one place the scale is defined. */
function zScale(): Map<string, number> {
  const css = readFileSync(join(STYLES_DIR, "tokens.css"), "utf8");
  const scale = new Map<string, number>();
  for (const m of css.matchAll(/(--z-[a-z-]+)\s*:\s*(\d+)\s*;/g)) {
    scale.set(m[1], Number(m[2]));
  }
  return scale;
}

/**
 * The z-index declaration belonging to the rule that introduces `selector`,
 * as a raw string (`var(--z-tray)`, `calc(var(--z-banner) - 1)`, `60`).
 */
function zIndexFor(selector: string): string {
  for (const file of readdirSync(STYLES_DIR).filter((f) => f.endsWith(".css"))) {
    const css = readFileSync(join(STYLES_DIR, file), "utf8");
    let from = 0;
    for (;;) {
      const at = css.indexOf(selector, from);
      if (at === -1) break;
      from = at + selector.length;
      const open = css.indexOf("{", at);
      const close = css.indexOf("}", open);
      if (open === -1 || close === -1) continue;
      const body = css.slice(open, close);
      const decl = body.match(/z-index:\s*([^;]+);/);
      if (decl) return decl[1].trim();
    }
  }
  throw new Error(`No rule with a z-index found for "${selector}"`);
}

/** Resolve a declaration to a number, following one level of `var()`/`calc()`. */
function resolve(decl: string, scale: Map<string, number>): number {
  const token = decl.match(/--z-[a-z-]+/);
  if (!token) {
    const n = Number(decl);
    if (Number.isNaN(n)) throw new Error(`Cannot resolve z-index "${decl}"`);
    return n;
  }
  const base = scale.get(token[0]);
  if (base === undefined) throw new Error(`Undefined token ${token[0]}`);
  const offset = decl.match(/-\s*(\d+)\s*\)?\s*$/);
  return decl.startsWith("calc") && offset ? base - Number(offset[1]) : base;
}

describe("app-level stacking order", () => {
  const scale = zScale();
  const layer = (selector: string) => resolve(zIndexFor(selector), scale);

  it("defines the scale in tokens.css", () => {
    for (const name of [
      "--z-tray",
      "--z-banner",
      "--z-toast",
      "--z-page-modal",
      "--z-overlay",
      "--z-modal",
    ]) {
      expect(scale.has(name), `${name} is missing from tokens.css`).toBe(true);
    }
  });

  it("puts the settings overlay above everything the page beneath can render", () => {
    const settings = layer(".settings-overlay");

    // The always-on trays, which are what sat at 996-998 over a z-60 overlay.
    for (const tray of [
      ".git-status-chip",
      ".active-operations-tray",
      ".refresh-queue-status",
      ".polling-suspension-indicator",
    ]) {
      expect(layer(tray), `${tray} must sit below the settings overlay`).toBeLessThan(settings);
    }

    // Toasts belonging to work-page sections.
    for (const toast of [".audit-toast", ".wf-toast", ".refresh-toast"]) {
      expect(layer(toast), `${toast} must sit below the settings overlay`).toBeLessThan(settings);
    }

    // Banners, and dialogs owned by a page rather than by the shell.
    for (const below of [
      ".memory-warning-banner",
      ".degradation-banner",
      ".reorg-overlay",
      ".delete-modal-backdrop",
      ".wf-preview-overlay",
    ]) {
      expect(layer(below), `${below} must sit below the settings overlay`).toBeLessThan(settings);
    }
  });

  it("keeps a dialog opened from the settings overlay above it", () => {
    // The unsaved-changes prompt renders inside the overlay; the prepare-task
    // modal is a shell-level dialog. Both must outrank the overlay itself.
    expect(layer(".leave-guard-backdrop")).toBeGreaterThan(layer(".settings-overlay"));
    expect(layer(".prep-backdrop")).toBeGreaterThan(layer(".settings-overlay"));
  });

  it("keeps crash recovery and the skip link above a stuck overlay", () => {
    expect(layer(".crash-recovery-banner")).toBeGreaterThan(layer(".settings-overlay"));
    expect(scale.get("--z-skip-link")!).toBeGreaterThan(scale.get("--z-easter-egg")!);
  });

  it("keeps the memory warning above the degradation banner", () => {
    // Both sit on --z-banner; the offset that separates them is easy to lose.
    expect(layer(".memory-warning-banner")).toBeGreaterThan(layer(".degradation-banner"));
  });

  it("leaves no app-level layer on a bare number", () => {
    // A literal here is how the original bug was written. Local stacking uses
    // small numbers and is out of scope, so only high literals are rejected.
    const offenders: string[] = [];
    for (const file of readdirSync(STYLES_DIR).filter((f) => f.endsWith(".css"))) {
      const css = readFileSync(join(STYLES_DIR, file), "utf8");
      for (const m of css.matchAll(/z-index:\s*(\d+)\s*;/g)) {
        if (Number(m[1]) >= 300) offenders.push(`${file}: z-index: ${m[1]}`);
      }
    }
    expect(
      offenders,
      `These should use a --z-* token from tokens.css instead of a raw number:\n  ` +
        offenders.join("\n  "),
    ).toEqual([]);
  });
});
