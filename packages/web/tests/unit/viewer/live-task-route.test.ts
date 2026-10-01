// @vitest-environment jsdom
/**
 * A task page needs a task id. Without one (a bare `/live-task` link, or a
 * route that lost its id when Settings opened over the page) the viewer shows
 * the Live overview at `/live`, and closing Settings returns to the same task.
 *
 * @see src/viewer/route-state.ts — normalizeLiveView
 * @see src/viewer/hooks/use-page-entry.ts
 * @see src/viewer/views/view-registry.ts — the "live-task" renderer
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render, Fragment } from "preact";
import type { VNode } from "preact";
import { act } from "preact/test-utils";
import { useRouteState } from "../../../src/viewer/hooks/use-route-state.js";
import { usePageEntry } from "../../../src/viewer/hooks/use-page-entry.js";
import { renderActiveView, type ViewRenderContext } from "../../../src/viewer/views/view-registry.js";
import { LiveView, LiveTaskView } from "../../../src/viewer/views/domain-live.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { emptyJobTray } from "../../helpers/job-tray.js";

const ALL = buildValidViews(null);

let root: HTMLDivElement;

async function mount(vnode: VNode): Promise<void> {
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(vnode, root); });
}

afterEach(() => {
  if (root) {
    render(null, root);
    root.remove();
  }
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

function ctx(selectedTaskId: string | null): ViewRenderContext {
  return {
    data: { manifest: null, inventory: null, imports: null, zones: null, components: null, callGraph: null },
    setDetail: () => {},
    setPrdDetailContent: () => {},
    selectedFile: null,
    setSelectedFile: () => {},
    selectedZone: null,
    selectedRunId: null,
    selectedTaskId,
    askSeed: null,
    navigateTo: () => {},
    isFeatureDisabled: () => false,
    askEnabled: false,
    jobs: emptyJobTray(),
  } as unknown as ViewRenderContext;
}

describe("the live-task renderer", () => {
  it("falls back to the Live overview with no task id", () => {
    expect((renderActiveView("live-task", ctx(null)) as VNode).type).toBe(LiveView);
  });

  it("renders the task page for a task id", () => {
    expect((renderActiveView("live-task", ctx("t1")) as VNode).type).toBe(LiveTaskView);
  });
});

/** Wires the route and the settings page memory the way main.ts does. */
function Harness() {
  const { view, selectedTaskId, navigateTo, handleSidebarNav } = useRouteState(ALL);
  const settingsOpen = view === "robot-wrangler";
  const { page, lastEntry } = usePageEntry(
    { view, file: null, zone: null, runId: null, taskId: selectedTaskId }, settingsOpen, "home",
  );
  return h(Fragment, null,
    h("div", { class: "page" }, `${page.view}|${page.taskId ?? ""}`),
    h("button", { class: "open", onClick: () => handleSidebarNav("robot-wrangler") }, "open"),
    h("button", { class: "close", onClick: () => navigateTo(lastEntry.view, { taskId: lastEntry.taskId ?? undefined }) }, "close"),
    h("button", { class: "bare", onClick: () => handleSidebarNav("live-task") }, "bare"),
  );
}

const pageText = () => root.querySelector(".page")?.textContent;
const click = (cls: string) => act(() => { root.querySelector<HTMLButtonElement>(`.${cls}`)!.click(); });

describe("route handling", () => {
  it("opens /live-task as the overview at /live", async () => {
    window.history.pushState(null, "", "/live-task");
    await mount(h(Harness, null));
    expect(pageText()).toBe("live|");
    expect(location.pathname).toBe("/live");
  });

  it("navigating to live-task without an id lands on /live", async () => {
    window.history.pushState(null, "", "/home");
    await mount(h(Harness, null));
    click("bare");
    expect(pageText()).toBe("live|");
    expect(location.pathname).toBe("/live");
  });

  it("returns to /live/task/X with the task page after opening and closing Settings", async () => {
    window.history.pushState(null, "", "/live/task/X");
    await mount(h(Harness, null));
    expect(pageText()).toBe("live-task|X");

    click("open");
    expect(location.pathname).toBe("/robot-wrangler");
    expect(pageText()).toBe("live-task|X"); // the page stays rendered underneath

    click("close");
    expect(location.pathname).toBe("/live/task/X");
    expect(pageText()).toBe("live-task|X");
  });
});
