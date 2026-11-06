// @vitest-environment jsdom
/**
 * Open changes keeps its area filter in the address: `/changes?area=<slug>`
 * survives a reload, the map badge's navigation sets it, removing the chip
 * (a bare navigation) clears it, and Back brings it back.
 *
 * @see src/viewer/hooks/use-route-state.ts — the `area` history field
 */
import { describe, it, expect, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { useRouteState } from "../../../src/viewer/hooks/use-route-state.js";
import { buildValidViews } from "../../../src/shared/index.js";

const ALL = buildValidViews(null);

let root: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => { render(null, root!); });
  root = null;
  window.history.replaceState(null, "", "/");
  document.body.innerHTML = "";
});

async function mount(path: string) {
  window.history.replaceState(null, "", path);
  let route: ReturnType<typeof useRouteState> | undefined;
  function Harness() {
    route = useRouteState(ALL);
    return null;
  }
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(h(Harness, null), root!); });
  return () => route!;
}

async function back() {
  await act(async () => {
    const popped = new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    history.back();
    await popped;
  });
}

describe("Open changes' area filter in route state", () => {
  it("reads ?area= on load and keeps it in the address bar", async () => {
    const route = await mount("/changes?area=checkout");
    expect(route().view).toBe("changes");
    expect(route().selectedArea).toBe("checkout");
    expect(location.search).toBe("?area=checkout");
  });

  it("ignores ?area= on any other view", async () => {
    const route = await mount("/prd?area=checkout");
    expect(route().selectedArea).toBeNull();
    expect(location.search).toBe("");
  });

  it("sets the filter on navigation, clears it on a bare one, and Back restores it", async () => {
    const route = await mount("/plan");
    await act(async () => { route().navigateTo("changes", { area: "checkout" }); });
    expect(route().selectedArea).toBe("checkout");
    expect(`${location.pathname}${location.search}`).toBe("/changes?area=checkout");

    await act(async () => { route().navigateTo("changes"); });
    expect(route().selectedArea).toBeNull();
    expect(`${location.pathname}${location.search}`).toBe("/changes");

    await back();
    expect(route().selectedArea).toBe("checkout");
  });

  it("drops the area when the sidebar opens the page", async () => {
    const route = await mount("/changes?area=checkout");
    await act(async () => { route().handleSidebarNav("changes"); });
    expect(route().selectedArea).toBeNull();
    expect(location.search).toBe("");
  });
});
