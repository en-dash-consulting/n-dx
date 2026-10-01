// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import {
  ProjectSwitcher,
  isCurrentProject,
  parseHubProjects,
  projectUrl,
  useHubProjects,
  type HubProjects,
} from "../../../src/viewer/components/project-switcher.js";
import { Breadcrumb } from "../../../src/viewer/components/breadcrumb.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";

const HUB_BODY = {
  projects: [
    { id: "alpha", name: "Alpha", repoRoot: "/r/alpha", status: { state: "healthy" } },
    { id: "beta", name: "Beta", repoRoot: "/r/beta", status: { state: "starting" } },
    { id: "gamma", name: "Gamma", repoRoot: "/r/gamma", status: { state: "stopped" } },
  ],
};

/** A fetch stand-in answering `/api/hub/projects` with `body`. */
function hubFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body } as unknown as globalThis.Response)) as typeof fetch;
}

/**
 * Let effects run and the stubbed fetches settle. Every stub here resolves on
 * microtasks (fetch → json → setState), so draining the microtask queue inside
 * `act` is the event itself — no real-timer sleep decides the verdict.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => { for (let j = 0; j < 10; j++) await Promise.resolve(); });
  }
}

function setPath(path: string): void {
  window.history.replaceState(null, "", path);
}

describe("parseHubProjects / projectUrl / isCurrentProject", () => {
  it("keeps id, name and supervisor state; rejects a body that is not the hub's", () => {
    expect(parseHubProjects(HUB_BODY)).toEqual([
      { id: "alpha", name: "Alpha", state: "healthy" },
      { id: "beta", name: "Beta", state: "starting" },
      { id: "gamma", name: "Gamma", state: "stopped" },
    ]);
    expect(parseHubProjects({ projects: [{ id: "x" }] })).toEqual([{ id: "x", name: "x", state: "stopped" }]);
    expect(parseHubProjects({})).toBeNull();
    expect(parseHubProjects(null)).toBeNull();
    expect(parseHubProjects("<html>")).toBeNull();
  });

  it("builds /p/<id>/<view>, dropping any worktree slot", () => {
    expect(projectUrl("beta", "prd")).toBe("/p/beta/prd");
    expect(projectUrl("a b", "hench-runs")).toBe("/p/a%20b/hench-runs");
  });

  it("matches the current project by the hub prefix only", () => {
    expect(isCurrentProject("alpha", "/p/alpha/prd")).toBe(true);
    expect(isCurrentProject("alpha", "/p/alpha/w/feature/prd")).toBe(true);
    expect(isCurrentProject("alpha", "/p/alphabet/prd")).toBe(false);
    expect(isCurrentProject("alpha", "/prd")).toBe(false);
  });
});

describe("useHubProjects", () => {
  let root: HTMLDivElement | null = null;
  afterEach(() => { if (root) cleanupRenderedDiv(root); root = null; });

  function Probe({ fetcher, out }: { fetcher: typeof fetch; out: { value?: HubProjects } }) {
    out.value = useHubProjects(fetcher);
    return null;
  }

  it("reports the hub and its projects when the hub answers", async () => {
    const out: { value?: HubProjects } = {};
    root = renderToDiv(h(Probe, { fetcher: hubFetch(HUB_BODY), out }));
    await flush();
    expect(out.value!.hub).toBe(true);
    expect(out.value!.projects.map((p) => p.id)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("reports no hub on a 404, on a non-hub body, and on a fetch that throws", async () => {
    for (const fetcher of [
      hubFetch({ error: "not found" }, false),
      hubFetch({}),
      (async () => { throw new Error("offline"); }) as unknown as typeof fetch,
    ]) {
      const out: { value?: HubProjects } = {};
      root = renderToDiv(h(Probe, { fetcher, out }));
      await flush();
      expect(out.value!.hub).toBe(false);
      expect(out.value!.projects).toEqual([]);
      cleanupRenderedDiv(root);
      root = null;
    }
  });
});

describe("ProjectSwitcher", () => {
  let root: HTMLDivElement | null = null;
  beforeEach(() => setPath("/p/alpha/prd"));
  afterEach(() => { if (root) cleanupRenderedDiv(root); root = null; setPath("/"); });

  const hubWith = (projects: HubProjects["projects"], reload = vi.fn(async () => {})): HubProjects =>
    ({ hub: true, projects, reload });
  const three = parseHubProjects(HUB_BODY)!;

  it("opens a listbox with a status dot per project, the current one marked, and navigates on choice", async () => {
    const navigate = vi.fn();
    const reload = vi.fn(async () => {});
    root = renderToDiv(h(ProjectSwitcher, { label: "Alpha", view: "prd", hub: hubWith(three, reload), navigate }));

    const trigger = root.querySelector("button")!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await act(async () => { trigger.click(); });
    expect(reload).toHaveBeenCalledTimes(1);
    const options = Array.from(root.querySelectorAll('[role="option"]'));
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Alpha"), expect.stringContaining("Beta"), expect.stringContaining("Gamma"),
    ]);
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(options[0].querySelector(".breadcrumb-project-dot-healthy")).not.toBeNull();
    expect(options[1].querySelector(".breadcrumb-project-dot-starting")).not.toBeNull();
    expect(root.querySelector(".breadcrumb-workspace-footer")!.getAttribute("href")).toBe("/hub");

    await act(async () => { (options[0] as HTMLElement).click(); });
    expect(navigate).not.toHaveBeenCalled();
    expect(root.querySelector('[role="listbox"]')).toBeNull();

    await act(async () => { trigger.click(); });
    await act(async () => { (root!.querySelectorAll('[role="option"]')[1] as HTMLElement).click(); });
    expect(navigate).toHaveBeenCalledWith("/p/beta/prd");
  });

  it("is keyboard operable: Arrow keys, Home/End, Enter/Space choose, Escape closes", async () => {
    const navigate = vi.fn();
    root = renderToDiv(h(ProjectSwitcher, { label: "Alpha", view: "hench-runs", hub: hubWith(three), navigate }));
    const wrapper = root.querySelector(".breadcrumb-switcher")!;
    const key = (k: string) => act(async () => {
      wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    });
    const active = () => root!.querySelector('[role="listbox"]')?.getAttribute("aria-activedescendant");

    await key("ArrowDown");
    expect(active()).toBe("project-option-alpha");
    await key("ArrowDown");
    expect(active()).toBe("project-option-beta");
    await key("End");
    expect(active()).toBe("project-option-gamma");
    await key("Home");
    expect(active()).toBe("project-option-alpha");
    await key("ArrowUp");
    expect(active()).toBe("project-option-alpha");
    await key("Escape");
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();

    await key("Enter");
    await key("End");
    await key(" ");
    expect(navigate).toHaveBeenCalledWith("/p/gamma/hench-runs");
    expect(root.querySelector('[role="listbox"]')).toBeNull();

    await key(" ");
    await key("ArrowDown");
    await key("Enter");
    expect(navigate).toHaveBeenLastCalledWith("/p/beta/hench-runs");
  });

  it("is plain text with one project, and with no hub", () => {
    for (const hub of [hubWith([three[0]]), { hub: false, projects: three, reload: async () => {} }]) {
      root = renderToDiv(h(ProjectSwitcher, { label: "Alpha", title: "Alpha project", view: "prd", hub }));
      expect(root.querySelector("button")).toBeNull();
      const span = root.querySelector(".breadcrumb-project")!;
      expect(span.tagName).toBe("SPAN");
      expect(span.textContent).toBe("Alpha");
      expect(span.getAttribute("title")).toBe("Alpha project");
      cleanupRenderedDiv(root);
      root = null;
    }
  });
});

describe("Breadcrumb hub segment", () => {
  let root: HTMLDivElement | null = null;
  beforeEach(() => {
    clearProjectMetadataCache();
    setPath("/p/alpha/prd");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ name: "Alpha", description: null, version: null, git: null, nameSource: "directory" }),
    })));
  });
  afterEach(() => {
    if (root) cleanupRenderedDiv(root);
    root = null;
    vi.unstubAllGlobals();
    setPath("/");
  });

  it("starts with a Hub link to /hub and a project menu behind a hub with several projects", async () => {
    root = renderToDiv(h(Breadcrumb, { view: "prd", navigateTo: () => {}, hubFetcher: hubFetch(HUB_BODY) }));
    await flush();
    const first = root.querySelector(".breadcrumb-list > li")!;
    const link = first.querySelector("a")!;
    expect(link.textContent).toBe("Hub");
    expect(link.getAttribute("href")).toBe("/hub");
    expect(root.querySelector(".breadcrumb-project-trigger")!.textContent).toContain("Alpha");
  });

  it("shows the Hub link but a plain name with one project", async () => {
    root = renderToDiv(h(Breadcrumb, {
      view: "prd", navigateTo: () => {}, hubFetcher: hubFetch({ projects: [HUB_BODY.projects[0]] }),
    }));
    await flush();
    expect(root.querySelector(".breadcrumb-hub")).not.toBeNull();
    expect(root.querySelector(".breadcrumb-project-trigger")).toBeNull();
    expect(root.querySelector("span.breadcrumb-project")!.textContent).toBe("Alpha");
  });

  it("has no Hub link without a hub", async () => {
    root = renderToDiv(h(Breadcrumb, {
      view: "prd", navigateTo: () => {}, hubFetcher: hubFetch({ error: "no route" }, false),
    }));
    await flush();
    expect(root.querySelector(".breadcrumb-hub")).toBeNull();
    expect(root.textContent).not.toContain("Hub");
    expect(root.querySelector("span.breadcrumb-project")!.textContent).toBe("Alpha");
  });
});
