// @vitest-environment jsdom
/**
 * Home survives a truncated `/api/status` body.
 *
 * `useProjectStatus` shape-checks the response once in `fetchStatus`
 * (`isValidProjectStatus`) rather than trusting an unchecked `const data:
 * ProjectStatus = await res.json()` cast. A 200 whose body is missing a
 * section, or carries a malformed one (`rex.stats = {}`, neither `null` nor a
 * real `TreeStats`), is treated the same as a failed fetch: the whole body is
 * discarded and every Home consumer sees `null`, not a half-populated object.
 * Before this existed, reading `status.sv.minutesAgo` on a half-populated
 * object threw during render and took the whole landing page down: the
 * default view, blank, on a response the server had called a success.
 *
 * This lives in its own file on purpose. `useProjectStatus` caches the first
 * body it fetches in a module-level variable, so a test that needs a *different*
 * body needs a module registry no other test has already warmed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { HomeView } from "../../../src/viewer/views/stage-pages.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { STAGE_ORDER, viewLabel } from "../../../src/viewer/views/index.js";

/** A 200 carrying only the Hench section — `sv` and `rex` never arrived. */
const PARTIAL_STATUS = {
  hench: { configured: true, totalRuns: 2, activeRuns: 0, staleRuns: 0 },
};

describe("Home with a partial /api/status body", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/status")) {
        return { ok: true, status: 200, json: async () => PARTIAL_STATUS };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  async function mountHome() {
    act(() => {
      render(h(HomeView, { validViews: buildValidViews(null), navigateTo: () => {} }), root);
    });
    await new Promise((r) => setTimeout(r, 10));
    await act(async () => {});
  }

  it("renders every stage card instead of throwing", async () => {
    await mountHome();
    const names = [...root.querySelectorAll(".stage-card-name")].map((e) => e.textContent);
    expect(names).toEqual(STAGE_ORDER.map((id) => viewLabel(id)));
  });

  it("omits every card's numbers — a partial body is discarded wholesale, not rendered piecemeal", async () => {
    await mountHome();
    const facts = (stage: string) =>
      root.querySelector(`.stage-card[data-stage="${stage}"] .stage-card-facts`);

    // The body fails `isValidProjectStatus` (no `sv`, no `rex`), so
    // `useProjectStatus` reports `null` — even the `hench` section that *did*
    // arrive is not trusted, matching how a fully-missing status renders.
    expect(facts("analyze")).toBeNull();
    expect(facts("plan")).toBeNull();
    expect(facts("work")).toBeNull();
  });

  it("names no next command, rather than guessing one from a body it rejected", async () => {
    await mountHome();
    // The panel speaks only for a status the viewer actually has. A rejected
    // body leaves it without one, and "not initialised" is the wrong guess to
    // make on a project whose real state is unknown.
    expect(root.querySelector(".next-step-panel")).toBeNull();
  });

  it("reports no unhandled render error", async () => {
    const onError = vi.fn();
    window.addEventListener("error", onError);
    await mountHome();
    window.removeEventListener("error", onError);
    expect(onError).not.toHaveBeenCalled();
  });
});
