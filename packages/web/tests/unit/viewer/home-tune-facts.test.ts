// @vitest-environment jsdom
/**
 * The Home Tune card does not repeat the Work card's run numbers.
 *
 * Own file: `useProjectStatus` caches its first body at module level.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { HomeView } from "../../../src/viewer/views/stage-pages.js";
import { buildValidViews } from "../../../src/shared/index.js";

const STATUS = {
  initialized: true,
  sv: { freshness: "fresh", modulesComplete: 3, modulesTotal: 3, minutesAgo: 5 },
  rex: {
    exists: true,
    percentComplete: 40,
    stats: { total: 10, pending: 4 },
    nextTaskTitle: "Next",
  },
  hench: { configured: true, totalRuns: 7, activeRuns: 1, staleRuns: 2 },
};

describe("Home stage card facts with a valid status", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes("/api/status") ? STATUS : {}),
    })));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("shows run facts on Work but not the same facts on Tune", async () => {
    act(() => {
      render(h(HomeView, { validViews: buildValidViews(null), navigateTo: () => {} }), root);
    });
    await new Promise((r) => setTimeout(r, 10));
    await act(async () => {});

    const facts = (stage: string) =>
      root.querySelector(`.stage-card[data-stage="${stage}"] .stage-card-facts`)?.textContent ?? null;

    expect(facts("work")).toBe("7runs1live2stale");
    expect(facts("tune")).not.toBe(facts("work"));
    expect(facts("tune")).toBeNull();
  });
});
