// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import {
  WorkspaceSwitcher,
  buildWorkspaceOptions,
  workspaceUrl,
  fmtElapsed,
} from "../../../src/viewer/components/workspace-switcher.js";
import { setBasePathForTests } from "../../../src/viewer/base-path.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";

const workspaces = [
  { key: "app", path: "/r/app", branch: "main", isAnchor: true, active: true },
  { key: "app-feature", path: "/r/app-feature", branch: "feature", isAnchor: false, active: false },
];
const worktrees = [
  { path: "/r/app", branch: "main", dirty: true, dirtyFiles: 3, runs: { total: 4, running: 0, lastFinishedAt: "2026-09-16T10:00:00Z" } },
  { path: "/r/app-feature", branch: "feature", dirty: false, dirtyFiles: 0, runs: { total: 1, running: 1, lastFinishedAt: null } },
];

/** A fetch stand-in returning plain response-like objects — no Response global needed under jsdom. */
function fetchReturning(ws: unknown, wt: unknown): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.endsWith("/api/workspaces") ? ws : wt;
    return { ok: true, json: async () => body } as unknown as globalThis.Response;
  }) as typeof fetch;
}

function fakeFetch(): typeof fetch {
  return fetchReturning({ anchor: "app", workspaces }, worktrees);
}

/** Let effects run, the fetches resolve, and the resulting state re-render. */
async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

describe("buildWorkspaceOptions / workspaceUrl / fmtElapsed", () => {
  it("joins registry keys with worktree state and marks the current one", () => {
    const opts = buildWorkspaceOptions(workspaces, worktrees, "app-feature");
    expect(opts.map((o) => [o.key, o.isCurrent, o.dirtyFiles, o.running])).toEqual([
      ["app", false, 3, 0],
      ["app-feature", true, 0, 1],
    ]);
    expect(buildWorkspaceOptions(workspaces, worktrees, null)[0].isCurrent).toBe(true);
  });

  it("builds the target URL under the project prefix and the /w/ slot", () => {
    expect(workspaceUrl({ key: "app", isAnchor: true }, "prd", "/w/app-feature/prd")).toBe("/prd");
    expect(workspaceUrl({ key: "app-feature", isAnchor: false }, "prd", "/prd")).toBe("/w/app-feature/prd");
    expect(workspaceUrl({ key: "app-feature", isAnchor: false }, "hench-runs", "/p/x/prd")).toBe("/p/x/w/app-feature/hench-runs");
  });

  it("formats elapsed time coarsely", () => {
    const now = Date.parse("2026-09-16T12:00:00Z");
    expect(fmtElapsed("2026-09-16T11:59:30Z", now)).toBe("30s ago");
    expect(fmtElapsed("2026-09-16T11:45:00Z", now)).toBe("15m ago");
    expect(fmtElapsed("2026-09-16T09:00:00Z", now)).toBe("3h ago");
    expect(fmtElapsed(null, now)).toBeNull();
  });
});

describe("WorkspaceSwitcher", () => {
  let root: HTMLDivElement | null = null;
  afterEach(() => { if (root) cleanupRenderedDiv(root); root = null; setBasePathForTests(null); });

  it("renders '<worktree> · <branch>', opens a listbox, and navigates on selection", async () => {
    setBasePathForTests("");
    const navigate = vi.fn();
    root = renderToDiv(h(WorkspaceSwitcher, { view: "prd", branch: "main", navigate, fetcher: fakeFetch() }));
    await flush();

    const trigger = root.querySelector("button")!;
    expect(trigger.textContent).toContain("app · main");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await act(async () => { trigger.click(); });
    await flush();
    const listbox = root.querySelector('[role="listbox"]')!;
    expect(listbox).not.toBeNull();
    const options = Array.from(root.querySelectorAll('[role="option"]'));
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("★ app · main"),
      expect.stringContaining("app-feature · feature"),
    ]);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[0].textContent).toContain("3 dirty");
    expect(options[1].querySelector(".breadcrumb-workspace-pulse")).not.toBeNull();
    expect(root.querySelector(".breadcrumb-workspace-footer")!.getAttribute("href")).toBe("/workspaces");

    await act(async () => { (options[1] as HTMLElement).click(); });
    expect(navigate).toHaveBeenCalledWith("/w/app-feature/prd");
  });

  it("is keyboard operable: ArrowDown opens and moves, Enter selects, Escape closes", async () => {
    setBasePathForTests("/w/app-feature");
    const navigate = vi.fn();
    root = renderToDiv(h(WorkspaceSwitcher, { view: "hench-runs", branch: "feature", navigate, fetcher: fakeFetch() }));
    await flush();
    const wrapper = root.querySelector(".breadcrumb-workspace")!;
    const key = (k: string) => act(async () => {
      wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    });

    expect(root.querySelector("button")!.textContent).toContain("app-feature · feature");
    await key("ArrowDown");
    expect(root.querySelector('[role="listbox"]')).not.toBeNull();
    // Highlight starts on the current (second) option; ArrowUp moves to the anchor.
    expect(root.querySelector('[role="listbox"]')!.getAttribute("aria-activedescendant")).toBe("workspace-option-app-feature");
    await key("ArrowUp");
    expect(root.querySelector('[role="listbox"]')!.getAttribute("aria-activedescendant")).toBe("workspace-option-app");
    await key("Enter");
    expect(navigate).toHaveBeenCalledWith("/hench-runs");
    expect(root.querySelector('[role="listbox"]')).toBeNull();

    await key("ArrowDown");
    expect(root.querySelector('[role="listbox"]')).not.toBeNull();
    await key("Escape");
    expect(root.querySelector('[role="listbox"]')).toBeNull();
  });

  it("is a plain, non-interactive chip when only one worktree exists", async () => {
    setBasePathForTests("");
    const single = fetchReturning({ anchor: "app", workspaces: [workspaces[0]] }, [worktrees[0]]);
    root = renderToDiv(h(WorkspaceSwitcher, { view: "prd", branch: "main", fetcher: single }));
    await flush();
    const trigger = root.querySelector("button")!;
    expect(trigger.hasAttribute("aria-haspopup")).toBe(false);
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(trigger.textContent).toContain("app · main");
  });
});
