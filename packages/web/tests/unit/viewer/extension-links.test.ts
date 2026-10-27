// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { extensionLinksPath, parseExtensionLinks } from "../../../src/viewer/components/extension-links.js";
import { ProjectContext } from "../../../src/viewer/components/project-context.js";
import { setBasePathForTests } from "../../../src/viewer/base-path.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";

const PROJECTS = { projects: [{ id: "alpha", name: "Alpha", repoRoot: "/r/alpha", status: { state: "healthy" } }] };

/** `GET /api/hub/extensions?project=alpha` as the hub answers it (hub/extensions.ts). */
const EXTENSIONS = {
  apiVersion: 1,
  errors: [],
  extensions: [
    {
      name: "recon", state: "enabled",
      links: [
        { label: "Assessment", url: "/x/recon/project/alpha" },
        { label: "Repo", url: "/x/recon/repo?root=%2Fr%2Falpha" },
      ],
    },
    { name: "off", state: "disabled", links: [] },
    { name: "plain", state: "enabled" },
  ],
};

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => { for (let j = 0; j < 10; j++) await Promise.resolve(); });
  }
}

/** A hub stand-in: answers each `/api/hub/*` path from `routes`, recording what was asked. */
function hubFetch(routes: Record<string, { ok: boolean; body: unknown } | "throw">, asked: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const route = routes[url.split("?")[0]];
    if (!route || route === "throw") throw new TypeError("network");
    return { ok: route.ok, json: async () => route.body } as unknown as globalThis.Response;
  }) as typeof fetch;
}

describe("parseExtensionLinks / extensionLinksPath", () => {
  it("flattens every extension's links and rejects a body that is not the hub's", () => {
    expect(parseExtensionLinks(EXTENSIONS)).toEqual([
      { label: "Assessment", url: "/x/recon/project/alpha" },
      { label: "Repo", url: "/x/recon/repo?root=%2Fr%2Falpha" },
    ]);
    expect(parseExtensionLinks({ projects: [] })).toBeNull();
    expect(parseExtensionLinks("<html>")).toBeNull();
    expect(parseExtensionLinks(null)).toBeNull();
  });

  it("keeps only hub-mounted URLs with a label", () => {
    const body = { extensions: [{ links: [
      { label: "Off hub", url: "https://example.com/" },
      { label: "", url: "/x/a/" },
      { label: "Root", url: "/p/alpha/" },
      { label: "Ok", url: "/x/a/b" },
      null,
    ] }] };
    expect(parseExtensionLinks(body)).toEqual([{ label: "Ok", url: "/x/a/b" }]);
  });

  it("lets the /p/<id>/ prefix name the project, else names the root alias's sole project", () => {
    expect(extensionLinksPath("/p/alpha", [])).toBe("/api/hub/extensions");
    expect(extensionLinksPath("", [{ id: "a b", name: "A", state: "healthy" }])).toBe("/api/hub/extensions?project=a%20b");
    expect(extensionLinksPath("", [])).toBeNull();
  });
});

describe("top bar project context: extension links", () => {
  let root: HTMLDivElement | null = null;
  beforeEach(() => {
    clearProjectMetadataCache();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ name: "Alpha", description: null, version: null, git: null, nameSource: "directory" }),
    })));
  });
  afterEach(() => {
    if (root) cleanupRenderedDiv(root);
    root = null;
    vi.unstubAllGlobals();
    setBasePathForTests(null);
  });

  it("renders the hub's resolved links under the /p/<id>/ prefix", async () => {
    setBasePathForTests("/p/alpha");
    const asked: string[] = [];
    root = renderToDiv(h(ProjectContext, {
      view: "prd",
      hubFetcher: hubFetch({
        "/api/hub/projects": { ok: true, body: PROJECTS },
        "/api/hub/extensions": { ok: true, body: EXTENSIONS },
      }, asked),
    }));
    await flush();
    const links = [...root.querySelectorAll("nav.project-context-links a")];
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Assessment", "/x/recon/project/alpha"],
      ["Repo", "/x/recon/repo?root=%2Fr%2Falpha"],
    ]);
    expect(asked).toContain("/api/hub/extensions");
  });

  it("names the sole project on the hub's root alias", async () => {
    setBasePathForTests("");
    const asked: string[] = [];
    root = renderToDiv(h(ProjectContext, {
      view: "prd",
      hubFetcher: hubFetch({
        "/api/hub/projects": { ok: true, body: PROJECTS },
        "/api/hub/extensions": { ok: true, body: EXTENSIONS },
      }, asked),
    }));
    await flush();
    expect(asked).toContain("/api/hub/extensions?project=alpha");
    expect(root.querySelectorAll(".project-context-link")).toHaveLength(2);
  });

  it("shows no links and does not ask without a hub", async () => {
    setBasePathForTests("");
    const asked: string[] = [];
    root = renderToDiv(h(ProjectContext, {
      view: "prd",
      hubFetcher: hubFetch({ "/api/hub/projects": "throw" }, asked),
    }));
    await flush();
    expect(root.querySelector(".project-context-links")).toBeNull();
    expect(asked.some((u) => u.startsWith("/api/hub/extensions"))).toBe(false);
    expect(root.querySelector(".breadcrumb-project")!.textContent).toBe("Alpha");
  });

  it("shows no links when the hub cannot list extensions", async () => {
    setBasePathForTests("/p/alpha");
    for (const extensions of [{ ok: false, body: { error: "n-dx could not be asked" } }, "throw" as const]) {
      root = renderToDiv(h(ProjectContext, {
        view: "prd",
        hubFetcher: hubFetch({ "/api/hub/projects": { ok: true, body: PROJECTS }, "/api/hub/extensions": extensions }),
      }));
      await flush();
      expect(root.querySelector(".project-context-links")).toBeNull();
      expect(root.querySelector(".breadcrumb-hub")).not.toBeNull();
      cleanupRenderedDiv(root);
      root = null;
    }
  });
});
