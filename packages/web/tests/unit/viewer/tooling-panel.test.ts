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

  function stub(config: unknown, catalog: unknown, auth: unknown = { ok: true }) {
    fetchSpy.mockImplementation((url: string) => {
      const body = url.includes("/catalog") ? catalog : url.includes("/commands/auth") ? auth : config;
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
    stub(CONFIG, CATALOG, { ok: false, error: "Not logged in" });
    mount();
    await waitFor(() => expect(text('[data-vendor="claude"] .tooling-state')).toBe("Signed out"));
    expect(root.querySelectorAll(".tooling-vendor")).toHaveLength(3);
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

  it("leaves a slot for the Sidecar and connections lines", async () => {
    stub(CONFIG, CATALOG);
    render(h(ToolingPanel, { navigateTo, extra: h("p", { class: "s8" }, "Sidecar on") }), root);
    await waitFor(() => expect(root.querySelector('[data-slot="sidecar-connections"] .s8')).not.toBeNull());
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
