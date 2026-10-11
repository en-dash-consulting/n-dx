// @vitest-environment jsdom
/**
 * Robot Wrangler: the settings page on the shared SettingsFrame. It renders
 * what the route resolved (`effective`, `effectiveProblems`, `claudeSources`)
 * and runs no validation of its own.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { RobotWranglerView } from "../../../src/viewer/views/robot-wrangler.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

type Json = Record<string, unknown>;

function config(overrides: Json = {}): Json {
  return {
    vendor: "claude",
    claude: { model: null, lightModel: null },
    codex: { model: null, lightModel: null },
    google: { model: null, lightModel: null },
    local: {
      model: null, lightModel: null, host: null, port: null, maxContextTokens: null, timeoutMs: null,
      verifier: { host: null, port: null, model: null, maxCycles: null },
    },
    claudeSources: {},
    effective: { vendor: "claude", provider: "cli", model: "claude-sonnet-5", modelSource: "default" },
    effectiveProblems: [],
    tiers: [
      { tier: "agent", model: "claude-sonnet-5", source: "catalog default", usedBy: [{ label: "ndx work" }] },
      { tier: "standard", model: "claude-sonnet-5", source: "catalog default", usedBy: [] },
      { tier: "light", model: "claude-haiku-4-5", source: "catalog default", usedBy: [] },
      { tier: "heavy", model: "claude-opus-5", source: "catalog default", usedBy: [] },
    ],
    failover: {
      enabled: false,
      applies: false,
      reason: "Failover is not available for Claude CLI. Only Claude on the API connection supports failover.",
      chain: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5", "claude-haiku-4-5"],
    },
    ...overrides,
  };
}

const CATALOG: Json = {
  claude: { models: ["claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5"], providers: ["cli", "api"], defaultModel: "claude-sonnet-5", source: "built-in", checkedAt: null, cli: { found: true, version: "2.0.0", path: "/bin/claude" } },
  codex: { models: ["gpt-5.5"], providers: ["cli"], defaultModel: "gpt-5.5", source: "built-in", checkedAt: null, cli: { found: false, version: null, path: null } },
  google: { models: ["gemini-2.5-pro"], providers: ["api"], defaultModel: "gemini-2.5-pro", source: "built-in", checkedAt: null },
  local: { models: [], providers: ["api"], defaultModel: "", reachable: false },
};

/** Serves GET /api/llm/config and the catalog, and records PUT bodies; everything else is empty. */
function stubApi(initial: Json) {
  const puts: Json[] = [];
  const mock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (String(url).includes("/api/llm/catalog")) {
      return { ok: true, status: 200, json: async () => CATALOG };
    }
    if (String(url).includes("/api/llm/config")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body ?? "{}") as Json;
        puts.push(body);
        return { ok: true, status: 200, json: async () => ({ config: initial }) };
      }
      return { ok: true, status: 200, json: async () => initial };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", mock);
  return { puts };
}

async function settle() {
  // Wait inside act so the state updates fetch resolutions trigger commit
  // synchronously rather than arming preact's after-paint fallback timer.
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

describe("RobotWranglerView", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    clearProjectMetadataCache();
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });

  async function mount() {
    act(() => { render(h(RobotWranglerView, null), root); });
    await settle();
  }

  it("renders inside exactly one settings frame, with no legacy save bar or toast", async () => {
    stubApi(config());
    await mount();
    expect(root.querySelectorAll(".settings-frame")).toHaveLength(1);
    expect(root.querySelector(".llm-save-bar")).toBeNull();
    expect(root.querySelector(".llm-toast")).toBeNull();
    expect(root.querySelector(".settings-frame-indicator")?.textContent).toBe("All changes saved");
  });

  it("shows legacy-key Claude fields as such and saves them to llm.claude.*", async () => {
    const { puts } = stubApi(config({
      claude: { model: "claude-opus-5", lightModel: "claude-haiku-4-5" },
      claudeSources: { model: "legacy", lightModel: "legacy" },
    }));
    await mount();

    const model = root.querySelector<HTMLSelectElement>('select[id="claude.model"]')!;
    const light = root.querySelector<HTMLSelectElement>('select[id="claude.lightModel"]')!;
    expect(model.value).toBe("claude-opus-5");
    expect(light.value).toBe("claude-haiku-4-5");
    expect(root.querySelector(".llm-legacy")?.textContent).toContain("claude.model and claude.lightModel are read from the legacy top-level key");

    await act(async () => {
      model.value = "claude-sonnet-5";
      model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(root.querySelector(".settings-frame-indicator")?.textContent).toBe("1 unsaved change · Standard model → claude-sonnet-5");

    await act(async () => { root.querySelector<HTMLButtonElement>(".settings-frame-save")!.click(); });
    await settle();
    expect(puts).toEqual([{ changes: { "llm.claude.model": "claude-sonnet-5" } }]);
  });

  it("shows no legacy notice when the fields come from llm.claude.*", async () => {
    stubApi(config({
      claude: { model: "claude-opus-5", lightModel: null },
      claudeSources: { model: "llm" },
    }));
    await mount();
    expect(root.querySelector(".llm-legacy")).toBeNull();
  });

  it("renders the failover section with header and chain", async () => {
    stubApi(config({
      vendor: "claude",
      effective: { vendor: "claude", provider: "api", model: "claude-sonnet-5", modelSource: "default" },
      failover: {
        enabled: false,
        applies: true,
        chain: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"],
      },
    }));
    await mount();
    // Find all sections and filter to the one with "If a run fails"
    const sections = Array.from(root.querySelectorAll(".llm-rw-section"));
    const failoverSection = sections.find((s) => s.textContent?.includes("If a run fails"));
    expect(failoverSection).toBeTruthy();
    expect(failoverSection?.textContent).toContain("Automatic failover");
    expect(root.querySelector(".llm-failover-chain")).toBeTruthy();
  });

  it("renders failover chain as pills joined by arrows when toggle is on", async () => {
    const { puts } = stubApi(config({
      vendor: "claude",
      autoFailover: true,
      effective: { vendor: "claude", provider: "api", model: "claude-sonnet-5", modelSource: "default" },
      failover: {
        enabled: true,
        applies: true,
        chain: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"],
      },
    }));
    await mount();

    const toggle = root.querySelector<HTMLInputElement>('input[id="autoFailover"]')!;
    const chain = root.querySelector(".llm-failover-chain")!;
    const pills = Array.from(chain.querySelectorAll(".llm-failover-pill")).map((p) => p.textContent);
    expect(pills).toEqual(["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"]);
    expect(toggle.checked).toBe(true);
    expect(chain.classList.contains("llm-failover-chain-dimmed")).toBe(false);
  });

  it("dims the chain when failover toggle is off", async () => {
    stubApi(config({
      vendor: "claude",
      effective: { vendor: "claude", provider: "api", model: "claude-sonnet-5", modelSource: "default" },
      failover: {
        enabled: false,
        applies: true,
        chain: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"],
      },
    }));
    await mount();

    const chain = root.querySelector(".llm-failover-chain")!;
    expect(chain.classList.contains("llm-failover-chain-dimmed")).toBe(true);
  });

  it("shows warning when failover cannot apply", async () => {
    stubApi(config({
      vendor: "claude",
      effective: { vendor: "claude", provider: "cli", model: "claude-sonnet-5", modelSource: "default" },
      failover: {
        enabled: false,
        applies: false,
        reason: "Failover is not available for Claude CLI. Only Claude on the API connection supports failover.",
        chain: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"],
      },
    }));
    await mount();

    const warning = root.querySelector(".llm-failover-warning")!;
    expect(warning.textContent).toContain("Failover is not available for Claude CLI");
    // Information, not an error: a status line, not an alert box.
    expect(warning.getAttribute("role")).toBe("status");
    expect(warning.querySelector(".llm-note-mark")?.textContent).toBe("!");
  });

  it("shows local-specific message when failover applies is false for local vendor", async () => {
    stubApi(config({
      vendor: "local",
      effective: { vendor: "local", provider: "api", model: "llama-2", modelSource: "default" },
      failover: {
        enabled: false,
        applies: false,
        reason: "Failover is not available for local models. Only Claude on the API connection supports failover.",
        chain: ["llama-2"],
      },
    }));
    await mount();

    const warning = root.querySelector(".llm-failover-warning")!;
    expect(warning.textContent).toContain("Failover is not available for local models");
  });

  it("saves autoFailover toggle when changed", async () => {
    const { puts } = stubApi(config({
      vendor: "claude",
      effective: { vendor: "claude", provider: "api", model: "claude-sonnet-5", modelSource: "default" },
      failover: {
        enabled: false,
        applies: true,
        chain: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"],
      },
    }));
    await mount();

    const toggle = root.querySelector<HTMLInputElement>('input[id="autoFailover"]')!;
    await act(async () => {
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(root.querySelector(".settings-frame-indicator")?.textContent).toBe("1 unsaved change · Auto failover → on");

    await act(async () => { root.querySelector<HTMLButtonElement>(".settings-frame-save")!.click(); });
    await settle();
    expect(puts).toEqual([{ changes: { "llm.autoFailover": true } }]);
  });
});
