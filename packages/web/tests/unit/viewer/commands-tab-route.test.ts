// @vitest-environment jsdom
/**
 * Settings › Commands keeps its tab in the route: `/command-reference` settles
 * on `/commands/reference`, reload keeps it, tab changes push history and Back
 * returns to the previous tab.
 *
 * @see src/viewer/route-state.ts — routeTab
 * @see src/viewer/hooks/use-route-state.ts — the `tab` history field
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

describe("the Commands tab in route state", () => {
  it("keeps /commands/reference in the address bar on load, so a reload reopens Reference", async () => {
    const route = await mount("/commands/reference");
    expect(route().view).toBe("commands");
    expect(route().selectedTab).toBe("reference");
    expect(location.pathname).toBe("/commands/reference");
  });

  it("settles /command-reference on /commands/reference", async () => {
    const route = await mount("/command-reference");
    expect(route().view).toBe("commands");
    expect(route().selectedTab).toBe("reference");
    expect(location.pathname).toBe("/commands/reference");
  });

  it("opens Reference from navigateTo(\"command-reference\")", async () => {
    const route = await mount("/home");
    await act(async () => { route().navigateTo("command-reference"); });
    expect(route().view).toBe("commands");
    expect(route().selectedTab).toBe("reference");
    expect(location.pathname).toBe("/commands/reference");
  });

  it("pushes a tab change, and Back returns to the previous tab", async () => {
    const route = await mount("/commands");
    expect(route().selectedTab).toBeNull();
    await act(async () => { route().navigateTo("commands", { tab: "reference" }); });
    expect(location.pathname).toBe("/commands/reference");
    await back();
    expect(route().selectedTab).toBeNull();
    expect(location.pathname).toBe("/commands");
  });

  it("drops a tab no view keeps in its path", async () => {
    const route = await mount("/commands/bogus");
    expect(route().selectedTab).toBeNull();
    await act(async () => { route().navigateTo("prd", { tab: "reference" }); });
    expect(route().selectedTab).toBeNull();
    expect(location.pathname).toBe("/prd");
  });
});
