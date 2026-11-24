// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AgentSettingsPanel, RULE_FIELDS, tierChangeKey, usedForLine } from "../../../src/viewer/views/agent-settings.js";
import { announceSettingsSaved } from "../../../src/viewer/views/settings-sync.js";

const LLM_CONFIG = {
  vendor: "claude",
  claude: { model: "", lightModel: "" },
  codex: {}, google: {}, local: {},
  claudeSources: {},
  agentModels: {},
  effective: { vendor: "claude", provider: "cli", model: "sonnet", modelSource: "default" },
  tiers: [
    { tier: "standard", model: "claude-sonnet", source: "catalog default", usedBy: [{ label: "analysis" }, { label: "planning" }] },
    { tier: "light", model: "claude-haiku", source: "catalog default", usedBy: [] },
  ],
  effectiveProblems: [],
};

const HENCH_CONFIG = {
  fields: RULE_FIELDS.slice(0, 2).map((path) => ({
    path, label: path, description: "d", type: "array", category: "guard", value: ["npm"], defaultValue: ["npm"], isDefault: true, impact: "i",
  })),
};

describe("agent settings helpers", () => {
  it("writes an agent-tier edit to hench.models and the rest under llm", () => {
    expect(tierChangeKey("agent.claude")).toBe("hench.models.claude");
    expect(tierChangeKey("claude.model")).toBe("llm.claude.model");
  });

  it("says what a tier is used for", () => {
    expect(usedForLine({ usedBy: [{ label: "analysis" }, { label: "planning" }] })).toBe("Used for analysis, planning");
    expect(usedForLine({ usedBy: [] })).toBeNull();
  });
});

describe("AgentSettingsPanel", () => {
  let root: HTMLDivElement;
  let calls: Array<{ url: string; method: string; body?: unknown }>;
  let llmReads = 0;

  beforeEach(() => {
    calls = [];
    llmReads = 0;
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      let body: unknown = {};
      if (url === "/api/llm/config" && method === "GET") { llmReads++; body = LLM_CONFIG; }
      else if (url === "/api/llm/config") body = { config: LLM_CONFIG };
      else if (url === "/api/llm/catalog") body = { claude: { models: ["claude-opus", "claude-sonnet"], providers: ["cli"], defaultModel: "claude-sonnet" } };
      else if (url === "/api/hench/config") body = HENCH_CONFIG;
      else if (url === "/api/agent-prompt") body = { path: ".ndx/agent-prompt.md", content: "", exists: false, bytes: 0, maxBytes: 32768, truncated: false, configured: false, warnings: [] };
      return { ok: true, status: 200, json: async () => body } as Response;
    }));
  });

  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });

  async function mount() {
    await act(async () => { render(h(AgentSettingsPanel, { navigateTo: vi.fn() }), root); });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  it("shows each tier with what it is used for, the rules, the prompt, and links to Settings", async () => {
    await mount();
    const tiers = [...root.querySelectorAll<HTMLElement>(".as-tier")];
    expect(tiers.map((t) => t.querySelector(".as-tier-name")?.textContent)).toEqual(["Standard", "Light"]);
    expect(tiers[0]!.querySelector(".as-tier-used")?.textContent).toBe("Used for analysis, planning");
    expect(root.querySelectorAll(".as-rules .hench-config-field")).toHaveLength(2);
    expect(root.querySelector(".as-prompt")).not.toBeNull();
    const links = [...root.querySelectorAll<HTMLAnchorElement>(".as-settings-link")].map((a) => a.getAttribute("href"));
    expect(links.some((href) => href?.includes("robot-wrangler") && href.includes("section=models"))).toBe(true);
    expect(links.some((href) => href?.includes("workflow"))).toBe(true);
  });

  it("saves a model through the endpoint Robot Wrangler uses", async () => {
    await mount();
    const select = root.querySelector<HTMLSelectElement>("#as-tier-standard")!;
    act(() => {
      select.value = "claude-opus";
      select.dispatchEvent(new Event("change"));
    });
    const save = [...root.querySelectorAll<HTMLButtonElement>(".as-models button")].find((b) => b.textContent === "Save models")!;
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); });
    const put = calls.find((c) => c.url === "/api/llm/config" && c.method === "PUT");
    expect(put?.body).toEqual({ changes: { "llm.claude.model": "claude-opus" } });
  });

  it("re-reads the models when Settings saves them", async () => {
    await mount();
    const before = llmReads;
    await act(async () => { announceSettingsSaved("llm", "robot-wrangler"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(llmReads).toBe(before + 1);
  });
});
