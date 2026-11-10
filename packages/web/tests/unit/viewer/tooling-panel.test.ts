// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { ToolingPanel } from "../../../src/viewer/views/tooling-panel.js";
import type { NavigateTo } from "../../../src/viewer/types.js";
import { robotWranglerSectionId } from "../../../src/viewer/views/robot-wrangler-sections.js";
import { summarizeTooling } from "../../../src/viewer/views/tooling-summary.js";
import { DEFAULT_CLI_NAME } from "../../../src/viewer/hooks/use-project-metadata.js";

async function waitFor(fn: () => void, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { fn(); return; } catch { await new Promise<void>((r) => setTimeout(r, 10)); }
  }
  fn();
}

const CONFIG = {
  effective: { vendor: "claude", provider: "cli" },
  vendorTiers: {
    claude: [
      { tier: "light", model: "claude-haiku" },
      { tier: "standard", model: "claude-sonnet" },
      { tier: "heavy", model: "claude-opus" },
    ],
    codex: [
      { tier: "light", model: "gpt-mini" },
      { tier: "standard", model: "gpt-std" },
      { tier: "heavy", model: "gpt-big" },
    ],
    local: [
      { tier: "light", model: "qwen-small" },
      { tier: "standard", model: "qwen-small" },
      { tier: "heavy", model: "qwen-small" },
    ],
  },
  routeOverrides: [{ taskClass: "prd.propose", label: "ndx plan", tier: "heavy" }],
  review: {
    mode: { value: "pair" },
    vendor: { value: "codex" },
    rounds: { value: 2 },
    models: { codex: { model: "gpt-review" } },
  },
};

const CATALOG = {
  claude: { cli: { found: true, version: "2.0" }, readiness: { state: "ready", summary: "Ready · CLI 2.0" } },
  codex: { cli: { found: false, version: null }, readiness: { state: "needs-setup", summary: "CLI not found" } },
  local: { readiness: { state: "unreachable", summary: "Not reachable · localhost:1234" } },
};

describe("ToolingPanel", () => {
  let root: HTMLDivElement;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let navigateTo: ReturnType<typeof vi.fn<NavigateTo>>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    navigateTo = vi.fn<NavigateTo>();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  /** `auth` is the cached-verdict body, or a promise standing in for a slow response. */
  function stub(config: unknown, catalog: unknown, auth: unknown = { cached: true, ok: true }) {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes("/commands/auth")) {
        return Promise.resolve(auth).then((body) => ({ ok: true, json: () => Promise.resolve(body) }));
      }
      const body = url.includes("/catalog") ? catalog : config;
      return Promise.resolve({ ok: body !== null, json: () => Promise.resolve(body) });
    });
  }

  const mount = () => render(h(ToolingPanel, { navigateTo }), root);
  const text = (sel: string) => root.querySelector(sel)?.textContent ?? "";

  it("renders vendors with state, a model per tier, route overrides and review pairing", async () => {
    stub(CONFIG, CATALOG);
    mount();
    await waitFor(() => expect(root.querySelectorAll(".tooling-vendor")).toHaveLength(3));

    expect(text('[data-vendor="claude"] .tooling-state')).toBe("Connected");
    expect(text('[data-vendor="codex"] .tooling-state')).toBe("Missing");
    expect(text('[data-vendor="local"] .tooling-state')).toBe("Missing");
    expect(text('[data-vendor="claude"] [data-tier="heavy"]')).toContain("claude-opus");
    expect(text('[data-vendor="codex"] [data-tier="light"]')).toContain("gpt-mini");
    expect(text(".tooling-routes")).toContain("ndx plan → Heavy");
    expect(text(".tooling-review")).toContain("codex (gpt-review) · 2 fix rounds");
  });

  it("has no editable control; tier and review lines link to their Robot Wrangler section", async () => {
    stub(CONFIG, CATALOG);
    mount();
    await waitFor(() => expect(root.querySelectorAll(".tooling-vendor")).toHaveLength(3));

    expect(root.querySelectorAll("input, select, textarea, button")).toHaveLength(0);
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>("a.tooling-link"));
    // Three vendors and the review line; route overrides name the config command instead.
    expect(links.map((a) => a.dataset.section)).toEqual(["models", "models", "models", "review"]);
    for (const a of links) {
      expect(a.getAttribute("href")).toMatch(new RegExp(`/robot-wrangler\\?section=${a.dataset.section}$`));
      // Every target section exists in Robot Wrangler under a known id.
      expect(robotWranglerSectionId(a.dataset.section ?? null)).not.toBeNull();
    }
    links[0].click();
    expect(navigateTo).toHaveBeenLastCalledWith("robot-wrangler", { section: "models" });
    links[3].click();
    expect(navigateTo).toHaveBeenLastCalledWith("robot-wrangler", { section: "review" });
  });

  it("names the CLI's config command as where route overrides change", async () => {
    stub(CONFIG, CATALOG);
    mount();
    await waitFor(() => expect(text(".tooling-routes")).toContain("ndx plan → Heavy"));
    // No project metadata in this test, so the CLI name is the default.
    expect(text(".tooling-routes")).toContain(`${DEFAULT_CLI_NAME} config`);
    expect(root.querySelector(".tooling-routes a")).toBeNull();
  });

  it("shows a signed-out active vendor without breaking the tile", async () => {
    stub(CONFIG, CATALOG, { cached: true, ok: false, error: "Not logged in" });
    mount();
    await waitFor(() => expect(text('[data-vendor="claude"] .tooling-state')).toBe("Signed out"));
    expect(root.querySelectorAll(".tooling-vendor")).toHaveLength(3);
  });

  it("renders from config and catalog without waiting on, or starting, a credential check", async () => {
    let answer!: (body: unknown) => void;
    stub(CONFIG, CATALOG, new Promise((resolve) => { answer = resolve; }));
    mount();
    // The cached-verdict read is still pending, yet the tile is up.
    await waitFor(() => expect(root.querySelectorAll(".tooling-vendor")).toHaveLength(3));
    expect(text('[data-vendor="claude"] .tooling-state')).toBe("Connected");

    answer({ cached: true, ok: false, error: "Not logged in" });
    await waitFor(() => expect(text('[data-vendor="claude"] .tooling-state')).toBe("Signed out"));

    // Only the cache is read: no POST, which would spawn `ndx auth` and the vendor CLI.
    const authCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes("/commands/auth"));
    expect(authCalls.map(([url, init]) => [url, (init as RequestInit | undefined)?.method ?? "GET"]))
      .toEqual([["/api/commands/auth/cached", "GET"]]);
  });

  it("keeps the catalog state when no credential check has run yet", async () => {
    stub(CONFIG, CATALOG, { cached: false });
    mount();
    await waitFor(() => expect(root.querySelectorAll(".tooling-vendor")).toHaveLength(3));
    await new Promise((r) => setTimeout(r, 20));
    expect(text('[data-vendor="claude"] .tooling-state')).toBe("Connected");
  });

  it("keeps the models when the catalog cannot be read", async () => {
    stub(CONFIG, null);
    mount();
    await waitFor(() => expect(root.querySelectorAll(".tooling-vendor")).toHaveLength(3));
    expect(text('[data-vendor="claude"] .tooling-state')).toBe("Status unavailable");
    expect(text('[data-vendor="claude"] [data-tier="standard"]')).toContain("claude-sonnet");
  });

  it("says so when the configuration cannot be read", async () => {
    stub(null, CATALOG);
    mount();
    await waitFor(() => expect(text(".stage-tile-empty")).toContain("Could not read"));
  });

  describe("Sidecar lines", () => {
    const SIDECAR_SETTINGS = { mode: "ask", contextCeiling: { worktree: 100000, hub: 40000 }, idleMs: 7_200_000 };
    const CONNECTIONS = {
      connections: [
        { id: "linear", label: "Linear", state: "connected", tools: 4 },
        { id: "notion", label: "Notion", state: "needs-sign-in", reason: "signed out", tools: 0 },
        { id: "jira", label: "Jira", state: "unavailable", reason: "not connected yet", tools: 0 },
      ],
    };

    function stubSidecar(on: boolean, connections: unknown = CONNECTIONS) {
      const catalog = { ...CATALOG, claude: { ...CATALOG.claude, defaultModel: "claude-sonnet" } };
      fetchSpy.mockImplementation((url: string) => {
        const body = url.includes("/api/features") ? { toggles: [{ key: "web.sidecar", enabled: on }] }
          : url.includes("/api/sidecar/settings") ? SIDECAR_SETTINGS
          : url.includes("/api/connections") ? connections
          : url.includes("/catalog") ? catalog
          : url.includes("/commands/auth") ? { ok: true }
          : CONFIG;
        return Promise.resolve({ ok: body !== null, json: () => Promise.resolve(body) });
      });
    }

    it("lists the Sidecar's vendor, model, mode and caps and each connection's sign-in state", async () => {
      stubSidecar(true);
      mount();
      await waitFor(() => expect(root.querySelectorAll(".tooling-connection")).toHaveLength(3));
      expect(text(".tooling-sidecar-settings")).toContain("Claude Code (claude-sonnet) · mode ask");
      expect(text(".tooling-sidecar-settings")).toContain("context 100k worktree · 40k hub · idle after 2 h");
      expect(text('[data-connection="linear"] .tooling-state')).toBe("Connected");
      expect(text('[data-connection="notion"] .tooling-state')).toBe("Signed out");
      expect(text('[data-connection="jira"] .tooling-state')).toBe("Unavailable");
      expect(root.querySelector('[data-connection="jira"] .tooling-state')?.getAttribute("title")).toBe("not connected yet");
    });

    it("links the Sidecar line to Workflow and connections to Project", async () => {
      stubSidecar(true);
      mount();
      await waitFor(() => expect(root.querySelectorAll(".tooling-connection")).toHaveLength(3));
      root.querySelector<HTMLAnchorElement>(".tooling-sidecar-settings a")?.click();
      expect(navigateTo).toHaveBeenLastCalledWith("workflow");
      root.querySelector<HTMLAnchorElement>('[data-connection="linear"] a')?.click();
      expect(navigateTo).toHaveBeenLastCalledWith("project");
    });

    it("says there are no connections when none are declared", async () => {
      stubSidecar(true, { connections: [] });
      mount();
      await waitFor(() => expect(text(".tooling-connections-none")).toBe("No connections"));
    });

    it("draws nothing and reads no Sidecar route while web.sidecar is off", async () => {
      stubSidecar(false);
      mount();
      await waitFor(() => expect(root.querySelectorAll(".tooling-vendor")).toHaveLength(3));
      await new Promise<void>((r) => setTimeout(r, 30));
      expect(root.querySelector('[data-testid="tooling-sidecar"]')).toBeNull();
      const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/api/sidecar") || u.includes("/api/connections"))).toBe(false);
    });
  });
});

describe("summarizeTooling", () => {
  it("reads a CLI that is found but not ready as signed out", () => {
    const s = summarizeTooling(
      { effective: { vendor: "codex", provider: "cli" } },
      { codex: { cli: { found: true, version: "1" }, readiness: { state: "needs-setup", summary: "API key missing" } } },
      null,
    );
    expect(s.vendors.find((v) => v.id === "codex")).toMatchObject({ state: "signed-out", active: true });
  });

  it("judges an active vendor on the API provider by its key, not a missing CLI", () => {
    const catalog = { claude: { cli: { found: false, version: null }, readiness: { state: "ready" as const, summary: "Ready · API key set" } } };
    const ready = summarizeTooling({ effective: { vendor: "claude", provider: "api" } }, catalog, null);
    expect(ready.vendors.find((v) => v.id === "claude")?.state).toBe("connected");
    const noKey = summarizeTooling(
      { effective: { vendor: "claude", provider: "api" } },
      { claude: { cli: { found: true, version: "2" }, readiness: { state: "needs-setup", summary: "API key missing" } } },
      null,
    );
    expect(noKey.vendors.find((v) => v.id === "claude")).toMatchObject({ state: "signed-out", detail: "API key missing" });
  });

  it("names review off and self without a reviewer", () => {
    expect(summarizeTooling({ review: { mode: { value: "off" }, vendor: { value: null }, rounds: { value: 1 }, models: {} } }, null, null).review)
      .toBe("Review off");
  });
});
