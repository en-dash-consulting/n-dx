// @vitest-environment jsdom
/**
 * `/work/prep/<taskId>` is the Work page with the Prepare task modal open, on
 * reload too and under the hub's `/p/<id>/` and the `/w/<key>/` slot; closing
 * the modal returns to `/work`.
 *
 * @see src/viewer/route-state.ts — parseWorkPath, viewPathname
 * @see src/viewer/views/view-registry.ts — the "work" renderer
 */
import { describe, it, expect, afterEach } from "vitest";
import { h, render } from "preact";
import type { VNode } from "preact";
import { act } from "preact/test-utils";
import { parsePathnameRoute, viewPathname } from "../../../src/viewer/route-state.js";
import { useRouteState } from "../../../src/viewer/hooks/use-route-state.js";
import { setBasePathForTests } from "../../../src/viewer/base-path.js";
import { renderActiveView, type ViewRenderContext } from "../../../src/viewer/views/view-registry.js";
import { PrepareTaskModal } from "../../../src/viewer/components/prepare-task-modal.js";
import { buildValidViews } from "../../../src/shared/index.js";

const ALL = buildValidViews(null);

afterEach(() => {
  setBasePathForTests(null);
  window.history.replaceState(null, "", "/");
  document.body.innerHTML = "";
});

describe("the /work/prep/<taskId> route", () => {
  it("parses to the work view with the task id, with or without a base path", () => {
    expect(parsePathnameRoute("/work/prep/task-1", ALL)).toEqual({ view: "work", subId: "task-1" });
    expect(parsePathnameRoute("/p/app/work/prep/task-1", ALL, "/p/app")).toEqual({ view: "work", subId: "task-1" });
    expect(parsePathnameRoute("/p/app/w/feature/work/prep/task-1", ALL, "/p/app/w/feature"))
      .toEqual({ view: "work", subId: "task-1" });
    expect(parsePathnameRoute("/work", ALL)).toEqual({ view: "work", subId: null });
  });

  it("reads no task id from any other Work sub-path, nor from the old rex-dashboard path", () => {
    expect(parsePathnameRoute("/work/other", ALL)).toEqual({ view: "work", subId: null });
    expect(parsePathnameRoute("/rex-dashboard/task-1", ALL)).toEqual({ view: "work", subId: null });
    expect(parsePathnameRoute("/rex-dashboard/prep/task-1", ALL)).toEqual({ view: "work", subId: "task-1" });
  });

  it("is the inverse of viewPathname", () => {
    expect(viewPathname("work", "task-1")).toBe("/work/prep/task-1");
    expect(viewPathname("work", null)).toBe("/work");
  });

  for (const base of ["", "/p/app", "/w/feature", "/p/app/w/feature"]) {
    it(`keeps the modal's address on reload and returns to /work on close (base "${base}")`, async () => {
      setBasePathForTests(base);
      window.history.replaceState(null, "", `${base}/work/prep/task-1`);
      let route: ReturnType<typeof useRouteState> | undefined;
      function Harness() {
        route = useRouteState(ALL);
        return null;
      }
      const root = document.createElement("div");
      document.body.appendChild(root);
      await act(async () => { render(h(Harness, null), root); });

      expect(route!.view).toBe("work");
      expect(route!.selectedTaskId).toBe("task-1");
      expect(location.pathname).toBe(`${base}/work/prep/task-1`);

      await act(async () => { route!.navigateTo("work"); });
      expect(route!.selectedTaskId).toBeNull();
      expect(location.pathname).toBe(`${base}/work`);
      await act(async () => { render(null, root); });
    });
  }
});

describe("the work renderer", () => {
  function ctx(selectedTaskId: string | null): ViewRenderContext {
    return { selectedTaskId, navigateTo: () => {}, validViews: ALL } as unknown as ViewRenderContext;
  }
  const children = (vnode: VNode) => [vnode.props.children].flat() as Array<VNode | null>;

  it("opens the Prepare task modal over the page for a task id", () => {
    const modal = children(renderActiveView("work", ctx("task-1")) as VNode).find((c) => c?.type === PrepareTaskModal);
    expect(modal?.props).toMatchObject({ taskId: "task-1" });
  });

  it("renders the bare page without one", () => {
    expect(children(renderActiveView("work", ctx(null)) as VNode).some((c) => c?.type === PrepareTaskModal)).toBe(false);
  });
});
