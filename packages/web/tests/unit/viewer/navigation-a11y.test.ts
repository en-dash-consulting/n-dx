// @vitest-environment jsdom
/**
 * Keyboard and screen-reader access to the navigation surfaces — at desktop
 * width and at the narrow width where the shell starts hiding text.
 *
 * Tag: [a11y] — run independently with: pnpm --filter @n-dx/web test:a11y
 *
 * jsdom does not apply media queries, so "narrow" cannot be observed by
 * rendering; it is read out of `shell.css` instead. The test collects every
 * class the stylesheet sets to `display: none` at or below 960px, then
 * recomputes each control's accessible name with those elements removed. A
 * control named only by text that the narrow layout hides is the defect this
 * catches, and it is invisible to a plain render.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TopNav } from "../../../src/viewer/components/top-nav.js";
import { StageLinks } from "../../../src/viewer/components/stage-links.js";
import { SettingsOverlay } from "../../../src/viewer/components/settings-overlay.js";
import { StagePage } from "../../../src/viewer/views/stage-pages.js";
import { STAGE_ORDER, STAGES, viewLabel, SETTINGS_ENTRIES } from "../../../src/viewer/views/index.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { clearProjectMetadataCache, resolveCliLabel } from "../../../src/viewer/hooks/use-project-metadata.js";

// ── Which classes the narrow layout hides ──────────────────────

/**
 * Class names the stylesheet sets to `display: none` in any `max-width` media
 * block at 960px or below — i.e. everything invisible at 768px.
 */
function classesHiddenWhenNarrow(): Set<string> {
  const css = readFileSync(
    join(import.meta.dirname, "../../../src/viewer/styles/shell.css"),
    "utf-8",
  );
  const hidden = new Set<string>();

  for (const match of css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{/g)) {
    if (Number(match[1]) > 960) continue;
    // Walk to the matching close brace of the media block.
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    const block = css.slice(start, i - 1);
    for (const rule of block.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/display:\s*none/.test(rule[2])) continue;
      for (const cls of rule[1].matchAll(/\.([A-Za-z0-9_-]+)/g)) hidden.add(cls[1]);
    }
  }
  return hidden;
}

const HIDDEN_WHEN_NARROW = classesHiddenWhenNarrow();

// ── Accessible name ────────────────────────────────────────────

/**
 * The control's accessible name: `aria-label`, else its visible text, else
 * `title` — the order a screen reader resolves them in. `hidden` names classes
 * whose elements are not rendered at this width, so their text cannot
 * contribute.
 */
function accessibleName(el: Element, hidden: Set<string>): string {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;

  const text = (function textOf(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const e = node as Element;
    if (e.getAttribute("aria-hidden") === "true") return "";
    if ([...e.classList].some((c) => hidden.has(c))) return "";
    return [...e.childNodes].map(textOf).join("");
  })(el).replace(/\s+/g, " ").trim();
  if (text) return text;

  return el.getAttribute("title")?.trim() ?? "";
}

const WIDTHS: [name: string, hidden: Set<string>][] = [
  ["desktop", new Set()],
  ["768px or narrower", HIDDEN_WHEN_NARROW],
];

/** Every control that must be reachable and named, in render order. */
function controls(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, [role='button'], a[href]")];
}

// ── Harness ────────────────────────────────────────────────────

const VALID = buildValidViews(null);

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/project")) {
      return {
        ok: true, status: 200,
        json: async () => ({ name: "demo", description: null, version: null, git: null, nameSource: "directory" }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

describe("[a11y] navigation surfaces are named and keyboard-reachable", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    clearProjectMetadataCache();
    root = document.createElement("div");
    document.body.appendChild(root);
    stubFetch();
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  async function mount(vnode: ReturnType<typeof h>) {
    act(() => { render(vnode, root); });
    await new Promise((r) => setTimeout(r, 10));
    await act(async () => {});
  }

  /**
   * Open a collapsed section — and leave an already-open one alone.
   *
   * A section remembers its open state in localStorage, which is not reset
   * between cases in this file, and each case here runs twice (once per
   * width). A blind `click()` therefore *closes* the section on the second
   * run, leaving nothing to assert on: the tab assertions below ran zero
   * times and still reported green until this read the state first.
   */
  function openSection(view: string): void {
    const toggle = root.querySelector<HTMLButtonElement>(
      `.stage-section[data-view="${view}"] .stage-section-toggle`,
    );
    if (toggle?.getAttribute("aria-expanded") === "true") return;
    act(() => { toggle?.click(); });
  }

  it("reads at least one hiding rule out of shell.css", () => {
    // Guards the guard: an empty set would make every assertion below vacuous.
    expect(HIDDEN_WHEN_NARROW.size).toBeGreaterThan(0);
    expect(HIDDEN_WHEN_NARROW).toContain("topnav-brand-text");
  });

  for (const [width, hidden] of WIDTHS) {
    describe(`at ${width}`, () => {
      it("every top-nav control keeps an accessible name", async () => {
        await mount(h(TopNav, {
          view: "analyze", validViews: VALID, onNavigate: () => {}, onOpenSearch: () => {},
        }));
        const unnamed = controls(root).filter((el) => !accessibleName(el, hidden));
        expect(unnamed.map((e) => e.className)).toEqual([]);
      });

      it("top-nav stage tabs are named by the navigation model", async () => {
        await mount(h(TopNav, {
          view: "analyze", validViews: VALID, onNavigate: () => {}, onOpenSearch: () => {},
        }));
        const tabs = [...root.querySelectorAll(".topnav-tab")];
        expect(tabs.map((t) => accessibleName(t, hidden)))
          .toEqual(STAGE_ORDER.map((id) => viewLabel(id)));
      });

      it("every stage link names the stage it steps to", async () => {
        await mount(h(StageLinks, { stage: "analyze", validViews: VALID, onNavigate: () => {} }));
        const links = [...root.querySelectorAll(".stage-link")];
        expect(links.length).toBe(2);
        for (const link of links) {
          const name = accessibleName(link, hidden);
          expect(name).toBeTruthy();
          // Names the destination, not just "next".
          expect(STAGE_ORDER.some((id) => name.includes(viewLabel(id))), name).toBe(true);
        }
      });

      it("every settings entry is named by the navigation model", async () => {
        await mount(h(SettingsOverlay, {
          view: "robot-wrangler", validViews: VALID, onNavigate: () => {}, onClose: () => {}, children: null,
        }));
        const items = [...root.querySelectorAll(".settings-overlay-item")];
        // Two entries are behind default-off feature toggles.
        expect(items.length).toBeGreaterThan(0);
        expect(items.length).toBeLessThanOrEqual(SETTINGS_ENTRIES.length);
        for (const item of items) {
          const name = accessibleName(item, hidden);
          expect(name).toBeTruthy();
          expect(name).not.toContain("{cli}");
          const known = SETTINGS_ENTRIES.some((e) => resolveCliLabel(viewLabel(e.view), "n-dx") === name);
          expect(known, `settings item "${name}" is in no model entry`).toBe(true);
        }
      });

      for (const stage of STAGE_ORDER) {
        it(`every control on the ${viewLabel(stage)} stage keeps an accessible name`, async () => {
          await mount(h(StagePage, {
            stage, validViews: VALID, navigateTo: () => {}, renderView: () => null,
          }));
          const unnamed = controls(root).filter((el) => !accessibleName(el, hidden));
          expect(unnamed.map((e) => e.className)).toEqual([]);
        });

        it(`every ${viewLabel(stage)} section toggle names its view`, async () => {
          await mount(h(StagePage, {
            stage, validViews: VALID, navigateTo: () => {}, renderView: () => null,
          }));
          for (const toggle of root.querySelectorAll(".stage-section-toggle")) {
            const view = toggle.closest("[data-view]")!.getAttribute("data-view")!;
            const section = STAGES[stage].sections.find((s) => s.view === view)!;
            // A grouped section (Terrain) is named by its group, not its first
            // tab's own label; the blurb is hidden when narrow, so the title
            // must carry the name alone either way.
            const expected = section.group?.heading ?? viewLabel(view as never);
            expect(accessibleName(toggle, hidden)).toContain(expected);
          }
        });

        it(`every ${viewLabel(stage)} section's tabs are named by their own view`, async () => {
          await mount(h(StagePage, {
            stage, validViews: VALID, navigateTo: () => {}, renderView: () => null,
          }));
          for (const section of STAGES[stage].sections.filter((s) => s.tabs?.length)) {
            openSection(section.view);
            const tabs = [...root.querySelectorAll(
              `.stage-section[data-view="${section.view}"] [role="tab"]`,
            )];
            expect(tabs, `${section.view} rendered no tabs`).toHaveLength(section.tabs!.length + 1);
            for (const tab of tabs) {
              const view = tab.getAttribute("data-tab")!;
              expect(accessibleName(tab, hidden)).toBe(viewLabel(view as never));
            }
          }
        });
      }
    });
  }

  it("every navigable control is a real button, so Tab reaches it", async () => {
    await mount(h(TopNav, {
      view: "analyze", validViews: VALID, onNavigate: () => {}, onOpenSearch: () => {},
    }));
    for (const el of controls(root)) {
      expect(el.tagName, el.className).toBe("BUTTON");
      // A negative tabindex would take it out of the tab order.
      expect(el.getAttribute("tabindex"), el.className).not.toBe("-1");
    }
  });

  it("a bounded scroll region is reachable by keyboard", async () => {
    await mount(h(StagePage, {
      stage: "plan", validViews: VALID, navigateTo: () => {}, renderView: () => null,
    }));
    // `hench-runs` is the Plan stage's scroll section; open it.
    const section = root.querySelector("[data-view='hench-runs']")!;
    act(() => { (section.querySelector(".stage-section-toggle") as HTMLButtonElement).click(); });
    await act(async () => {});

    const body = section.querySelector(".stage-section-body--scroll");
    expect(body, "the scroll section did not open").not.toBeNull();
    expect(body!.getAttribute("tabindex")).toBe("0");
  });
});
