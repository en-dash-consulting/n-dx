// @vitest-environment jsdom
/**
 * Home survives a truncated `/api/status` body.
 *
 * `useProjectStatus` parses the response with `const data: ProjectStatus =
 * await res.json()` — an unchecked cast — so a 200 whose body is missing a
 * section reaches the Home cards typed as though it were complete. Before this
 * was guarded, reading `status.sv.minutesAgo` threw during render and took the
 * whole landing page down: the default view, blank, on a response the server
 * had called a success.
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

  it("omits the numbers for the sections that did not arrive", async () => {
    await mountHome();
    const facts = (stage: string) =>
      root.querySelector(`.stage-card[data-stage="${stage}"] .stage-card-facts`);

    // No `sv` — the Analysis card keeps its name and blurb, drops its numbers.
    expect(facts("analyze")).toBeNull();
    // No `rex` — the Plan card reads as "no PRD yet", which is what a viewer
    // with no PRD already sees, rather than inventing a count.
    expect(facts("plan")?.textContent).toContain("no PRD yet");
    // `hench` did arrive, so the Work card is unaffected.
    expect(facts("work")?.textContent).toContain("runs");
  });

  it("reports no unhandled render error", async () => {
    const onError = vi.fn();
    window.addEventListener("error", onError);
    await mountHome();
    window.removeEventListener("error", onError);
    expect(onError).not.toHaveBeenCalled();
  });
});
