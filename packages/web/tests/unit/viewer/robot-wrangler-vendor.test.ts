// @vitest-environment jsdom
/**
 * Robot Wrangler's vendor-aware fields: the provider choices hench accepts, the
 * per-vendor agent model picker, and the project/light model dropdowns — all
 * driven by GET /api/llm/catalog, with no model list hard-coded in the viewer.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { RobotWranglerView } from "../../../src/viewer/views/robot-wrangler.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

type Json = Record<string, unknown>;

const VENDORS = ["claude", "codex", "google", "local"] as const;
type Vendor = (typeof VENDORS)[number];

const CLI = { found: true, version: "2.1.0", path: "/usr/local/bin/x" };

function catalog(overrides: Json = {}): Json {
  return {
    claude: {
      models: ["claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5"],
      providers: ["cli", "api"], defaultModel: "claude-sonnet-5",
      source: "live", checkedAt: "2026-10-01T12:00:00.000Z", cli: CLI,
      readiness: { state: "ready", summary: "Ready · CLI 2.1.0", apiKey: false },
    },
    codex: {
      models: ["gpt-5.5", "gpt-5.6-sol"], providers: ["cli"], defaultModel: "gpt-5.5",
      source: "built-in", checkedAt: null, reason: "No OPENAI_API_KEY", cli: { found: false, version: null, path: null },
      readiness: { state: "needs-setup", summary: "CLI not found" },
    },
    google: {
      models: ["gemini-2.5-pro", "gemini-3.7-flash"], providers: ["api"], defaultModel: "gemini-2.5-pro",
      source: "built-in", checkedAt: null, reason: "No live model list for google",
      readiness: { state: "needs-setup", summary: "API key missing", apiKey: false },
    },
    local: {
      models: ["qwen3-coder-30b"], providers: ["api"], defaultModel: "qwen3-coder-30b", reachable: true,
      readiness: { state: "ready", summary: "Ready · localhost:1234" },
    },
    ...overrides,
  };
}

/** The server's tier table with nothing configured: every tier on the catalog default. */
function tierRows(model = "claude-sonnet-5"): Json[] {
  const row = (tier: string, labels: string[]) => ({
    tier, model, source: "catalog default", usedBy: labels.map((label) => ({ label })),
  });
  return [
    row("agent", ["ndx work"]),
    row("standard", ["ndx plan", "ndx add"]),
    row("light", ["commit messages", "summaries"]),
    row("heavy", ["tasks set to Heavy in Prepare task"]),
  ];
}

function config(vendor: Vendor, overrides: Json = {}): Json {
  return {
    vendor,
    claude: { model: null, lightModel: null },
    codex: { model: null, lightModel: null },
    google: { model: null, lightModel: null },
    local: {
      model: null, lightModel: null, host: null, port: null, maxContextTokens: null, timeoutMs: null,
      verifier: { host: null, port: null, model: null, maxCycles: null },
    },
    claudeSources: {},
    agentModels: {},
    effective: { vendor, provider: "cli", model: "claude-sonnet-5", modelSource: "default" },
    effectiveProblems: [],
    tiers: tierRows(),
    failover: {
      enabled: false,
      applies: false,
      reason: "Failover is not available for Claude CLI. Only Claude on the API connection supports failover.",
      chain: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5", "claude-haiku-4-5"],
    },
    ...overrides,
  };
}

interface Call { method: string; url: string; body?: Json }

/**
 * Routes by URL, records every call in order, and lets a test fail a PUT.
 * `failHench` answers PUT /api/hench/config with a 400.
 */
function stubApi(opts: { config: Json; catalog?: Json; henchProvider?: string; failHench?: boolean }) {
  const calls: Call[] = [];
  const mock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) as Json : undefined;
    calls.push({ method, url: String(url), body });
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
    const u = String(url);
    if (u.includes("/api/llm/catalog")) return ok(opts.catalog ?? catalog());
    if (u.includes("/api/llm/local-status")) return ok({ ok: true, url: "http://localhost:1234", models: ["qwen3-coder-30b"] });
    if (u.includes("/api/llm/config")) return ok(method === "PUT" ? { applied: [], config: opts.config } : opts.config);
    if (u.includes("/api/hench/config")) {
      if (method === "PUT") {
        return opts.failHench
          ? { ok: false, status: 400, json: async () => ({ error: 'Provider "api" is not supported for vendor "codex".' }) }
          : ok({ applied: [] });
      }
      return ok({ config: { provider: opts.henchProvider ?? "cli" } });
    }
    return ok({});
  });
  vi.stubGlobal("fetch", mock);
  return { calls, puts: () => calls.filter((c) => c.method === "PUT") };
}

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

describe("Robot Wrangler — vendor provider and model fields", () => {
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

  const select = (id: string) => root.querySelector<HTMLSelectElement>(`select[id="${id}"]`);
  const optionValues = (el: HTMLSelectElement) => Array.from(el.options).map((o) => o.value);
  const optionLabels = (el: HTMLSelectElement) => Array.from(el.options).map((o) => o.textContent);

  const card = (vendor: Vendor) => root.querySelector<HTMLButtonElement>(`.llm-vendor-card-${vendor}`)!;
  const connection = (provider: string) =>
    root.querySelector<HTMLButtonElement>(`.llm-connection-card-${provider}`)!;

  async function pickConnection(provider: string) {
    await act(async () => { connection(provider).click(); });
  }

  /** The select ids of the default tier rows, as the page keys them. */
  const tierIds = (vendor: Vendor) =>
    [`agent.${vendor}`, `${vendor}.model`, `${vendor}.lightModel`, `tiers.${vendor}.heavy`];

  async function choose(el: HTMLSelectElement, value: string) {
    await act(async () => {
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function save() {
    await act(async () => { root.querySelector<HTMLButtonElement>(".settings-frame-save")!.click(); });
    await settle();
  }

  describe("a config response missing server-resolved blocks", () => {
    it("renders the vendor cards and a bare failover toggle when there is no failover block", async () => {
      stubApi({ config: config("claude", { failover: undefined, autoFailover: true }) });
      await mount();

      for (const vendor of VENDORS) expect(card(vendor)).toBeTruthy();
      expect(root.querySelector<HTMLInputElement>('input[id="autoFailover"]')!.checked).toBe(true);
      expect(root.querySelector(".llm-failover-chain")).toBeNull();
      expect(root.querySelector(".llm-failover-warning")).toBeNull();
    });

    it("keeps the rest of the page when the tiers block is missing too", async () => {
      stubApi({ config: config("claude", { failover: undefined, tiers: undefined }) });
      await mount();

      for (const vendor of VENDORS) expect(card(vendor)).toBeTruthy();
      expect(root.querySelector(".llm-tier-row")).toBeNull();
      expect(root.querySelector('input[id="autoFailover"]')).toBeTruthy();
    });
  });

  describe.each(VENDORS)("%s", (vendor) => {
    it("offers one connection card per catalog provider, one fixed card with the reason when there is one", async () => {
      stubApi({ config: config(vendor) });
      await mount();
      const providers = (catalog()[vendor] as { providers: string[] }).providers;

      const cards = Array.from(root.querySelectorAll(".llm-connection-cards [role=radio]"));
      expect(cards.map((c) => c.className.match(/llm-connection-card-(\w+)/)?.[1])).toEqual(providers);
      expect(root.querySelector("select#provider")).toBeNull();
      if (providers.length === 1) {
        expect(cards[0].textContent).toContain("The only connection n-dx supports for");
        expect(cards[0].getAttribute("aria-checked")).toBe("true");
      }
    });

    it("shows the catalog's readiness summary on the vendor's card", async () => {
      stubApi({ config: config(vendor) });
      await mount();
      const summary = ((catalog()[vendor] as { readiness: { summary: string } }).readiness).summary;
      expect(card(vendor).querySelector(".llm-vendor-card-ready")?.textContent).toBe(summary);
    });

    it("lists the catalog models for every tier, and nothing else", async () => {
      stubApi({ config: config(vendor) });
      await mount();
      const models = (catalog()[vendor] as { models: string[] }).models;

      for (const id of tierIds(vendor)) {
        expect(optionValues(select(id)!)).toEqual(["", ...models, "__other__"]);
      }
    });

    it("offers the unset choice first, naming the model it resolves to, and 'Other model id…' last", async () => {
      stubApi({ config: config(vendor, { tiers: tierRows("resolved-model") }) });
      await mount();

      const labels = optionLabels(select(`agent.${vendor}`)!);
      expect(labels[0]).toBe("Default (resolved-model)");
      expect(labels[labels.length - 1]).toBe("Other model id…");
    });

    it("saves the agent model as hench.models.<vendor> and clears it with null", async () => {
      const model = (catalog()[vendor] as { models: string[] }).models[0];
      const api = stubApi({ config: config(vendor, { agentModels: { [vendor]: model } }) });
      await mount();

      await choose(select(`agent.${vendor}`)!, "");
      await save();

      expect(api.puts()).toHaveLength(1);
      expect(api.puts()[0].body).toEqual({ changes: { [`hench.models.${vendor}`]: null } });
    });

    it("saves a free-entry agent model typed under 'Other model id…'", async () => {
      const api = stubApi({ config: config(vendor) });
      await mount();

      await choose(select(`agent.${vendor}`)!, "__other__");
      const input = root.querySelector<HTMLInputElement>(".llm-tier-row-agent input[type=text]")!;
      await act(async () => {
        input.value = "my-custom-model";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await save();

      expect(api.puts()[0].body).toEqual({ changes: { [`hench.models.${vendor}`]: "my-custom-model" } });
    });
  });

  it("shows where the list came from and refreshes it with ?refresh=true", async () => {
    const api = stubApi({ config: config("claude") });
    await mount();

    const status = root.querySelector(".llm-runcard-checks")!;
    expect(status.textContent).toContain("Live list, checked");

    await act(async () => {
      Array.from(status.querySelectorAll("button")).find((b) => b.textContent === "Refresh models")!.click();
    });
    await settle();

    expect(api.calls.some((c) => c.url.includes("/api/llm/catalog?refresh=true"))).toBe(true);
  });

  it("names the reason for a built-in list", async () => {
    stubApi({ config: config("codex") });
    await mount();
    expect(root.querySelector(".llm-runcard-checks")?.textContent).toContain("Built-in list — No OPENAI_API_KEY");
  });

  it("reports the installed CLI and its version for claude, and a missing one for codex", async () => {
    stubApi({ config: config("claude") });
    await mount();
    expect(root.querySelector(".llm-runcard-checks")?.textContent).toContain("CLI found2.1.0");
    act(() => { render(null, root); });

    stubApi({ config: config("codex", { effective: { vendor: "codex", provider: "cli", model: "gpt-5.5", modelSource: "default" } }) });
    await mount();
    expect(root.querySelector(".llm-runcard-checks")?.textContent).toContain("CLI not found");
  });

  it("shows no CLI row for google or local", async () => {
    stubApi({ config: config("google") });
    await mount();
    expect(root.querySelector(".llm-runcard-checks")?.textContent).not.toContain("CLI");
  });

  it("withholds the tier table for a vendor picked but not saved, with no stale options and no reload", async () => {
    const api = stubApi({ config: config("claude") });
    await mount();
    expect(optionValues(select("agent.claude")!)).toContain("claude-opus-5");

    await act(async () => { card("codex").click(); });

    // The server resolved the table for claude; it has none for codex until saved.
    expect(select("agent.claude")).toBeNull();
    expect(select("agent.codex")).toBeNull();
    expect(root.querySelector(".llm-tier-pending")?.textContent).toBe("Save the vendor change to choose models for codex.");
    expect(root.querySelectorAll(".llm-connection-cards [role=radio]")).toHaveLength(1);
    expect(connection("cli").getAttribute("aria-checked")).toBe("true");
    expect(api.calls.filter((c) => c.url.includes("/api/llm/catalog"))).toHaveLength(1);
  });

  it("keeps a stored model the list lacks as its own option", async () => {
    stubApi({ config: config("claude", { claude: { model: "claude-legacy-1", lightModel: null } }) });
    await mount();
    const el = select("claude.model")!;
    expect(el.value).toBe("claude-legacy-1");
    expect(optionValues(el)).toContain("claude-legacy-1");
  });

  describe("tier table", () => {
    const rows = () => Array.from(root.querySelectorAll(".llm-tier-row"));
    const text = (row: Element, sel: string) => row.querySelector(sel)?.textContent;

    it("renders one row per server tier with its used-by labels, in the server's order", async () => {
      stubApi({ config: config("claude") });
      await mount();

      expect(rows().map((r) => text(r, ".llm-field-label"))).toEqual(["Agent model", "Standard", "Light", "Heavy"]);
      expect(text(rows()[1], ".llm-tier-used")).toBe("Used by ndx plan, ndx add");
      expect(text(rows()[3], ".llm-tier-used")).toBe("Used by tasks set to Heavy in Prepare task");
      expect(root.querySelector(".llm-tier-section .llm-rw-section-subtitle")?.textContent)
        .toBe("Commands and tasks pick a tier; you pick the model for each");
      expect(root.querySelector(".llm-tier-note")?.textContent).toBe(
        "Agent model overrides Standard for n-dx work only. A --model flag or a task's saved run settings win for that run.");
    });

    it("shows the Free row only when the server sends it", async () => {
      stubApi({ config: config("claude") });
      await mount();
      expect(root.querySelector(".llm-tier-row-free")).toBeNull();

      act(() => { render(null, root); });
      stubApi({ config: config("claude", {
        tiers: [...tierRows(), { tier: "free", model: "claude-haiku-4-5", source: "llm.tiers.claude.free", usedBy: [] }],
      }) });
      await mount();
      expect(text(root.querySelector(".llm-tier-row-free")!, ".llm-field-label")).toBe("Free");
      expect(select("tiers.claude.free")!.value).toBe("claude-haiku-4-5");
    });

    it("tells unset rows from set ones: dashed select and 'Runs as', solid select and 'Set in'", async () => {
      stubApi({ config: config("claude", {
        agentModels: { claude: "claude-opus-5" },
        tiers: tierRows().map((r) => r.tier === "agent"
          ? { ...r, model: "claude-opus-5", source: "hench.models.claude" } : r),
      }) });
      await mount();

      const [agent, standard] = rows();
      expect(agent.querySelector("select")!.classList.contains("llm-select-set")).toBe(true);
      expect(text(agent, ".llm-tier-source")).toBe("Set in hench.models.claude");
      expect(standard.querySelector("select")!.classList.contains("llm-select-unset")).toBe(true);
      expect(text(standard, ".llm-tier-source")).toBe("Runs as claude-sonnet-5");
    });

    it("saves Heavy as llm.tiers.<vendor>.heavy and clears it by removing the key", async () => {
      const api = stubApi({ config: config("claude") });
      await mount();

      await choose(select("tiers.claude.heavy")!, "claude-opus-5");
      expect(text(root.querySelector(".llm-tier-row-heavy")!, ".llm-tier-source")).toBe("Set in llm.tiers.claude.heavy");
      await save();
      expect(api.puts()[0].body).toEqual({ changes: { "llm.tiers.claude.heavy": "claude-opus-5" } });

      act(() => { render(null, root); });
      const cleared = stubApi({ config: config("claude", {
        tiers: tierRows().map((r) => r.tier === "heavy"
          ? { ...r, model: "claude-opus-5", source: "llm.tiers.claude.heavy" } : r),
      }) });
      await mount();
      expect(select("tiers.claude.heavy")!.value).toBe("claude-opus-5");

      await choose(select("tiers.claude.heavy")!, "");
      await save();
      expect(cleared.puts()[0].body).toEqual({ changes: { "llm.tiers.claude.heavy": null } });
    });

    it("saves Standard and Light as llm.<vendor>.model and .lightModel", async () => {
      const api = stubApi({ config: config("codex", { effective: { vendor: "codex", provider: "cli", model: "gpt-5.5", modelSource: "default" } }) });
      await mount();

      await choose(select("codex.model")!, "gpt-5.5");
      await choose(select("codex.lightModel")!, "gpt-5.6-sol");
      await save();
      expect(api.puts()[0].body).toEqual({ changes: { "llm.codex.model": "gpt-5.5", "llm.codex.lightModel": "gpt-5.6-sol" } });
    });

    it("lists the local server's live models for the Local vendor", async () => {
      stubApi({
        config: config("local"),
        catalog: catalog({ local: { models: [], providers: ["api"], defaultModel: "", reachable: true } }),
      });
      await mount();
      expect(optionValues(select("local.model")!)).toEqual(["", "qwen3-coder-30b", "__other__"]);
    });
  });

  it("uses no model list of its own: the viewer source names no model id", () => {
    // Vitest runs from packages/web; jsdom's URL cannot build a file: URL here.
    const src = readFileSync(join(process.cwd(), "src/viewer/views/robot-wrangler.ts"), "utf-8");
    expect(src).not.toContain("MODEL_SUGGESTIONS");
    expect(src).not.toMatch(/["'`](claude-(sonnet|opus|haiku|fable)|gpt-5|gemini-)/);
  });

  describe("radio cards", () => {
    const key = (el: Element, k: string) =>
      act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });

    it("forms a radiogroup with a roving tabindex on the selected vendor", async () => {
      stubApi({ config: config("claude") });
      await mount();
      const group = root.querySelector(".llm-vendor-cards")!;
      expect(group.getAttribute("role")).toBe("radiogroup");
      const cards = Array.from(group.querySelectorAll<HTMLElement>("[role=radio]"));
      expect(cards.map((c) => c.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false"]);
      expect(cards.map((c) => c.tabIndex)).toEqual([0, -1, -1, -1]);
    });

    it("moves the selection and focus with the arrow keys, wrapping, as an unsaved edit", async () => {
      const api = stubApi({ config: config("claude") });
      await mount();
      await key(card("claude"), "ArrowRight");
      expect(card("codex").getAttribute("aria-checked")).toBe("true");
      expect(card("codex").tabIndex).toBe(0);
      expect(document.activeElement).toBe(card("codex"));
      expect(root.querySelector(".settings-frame-indicator")?.textContent).toBe("Unsaved changes");

      await key(card("codex"), "ArrowLeft");
      await key(card("claude"), "ArrowLeft");
      expect(card("local").getAttribute("aria-checked")).toBe("true");
      expect(api.puts()).toHaveLength(0);
    });

    it("marks a missing API key on the connection that needs it", async () => {
      stubApi({ config: config("claude") });
      await mount();
      expect(connection("cli").textContent).toContain("Uses your claude login. Recommended.");
      expect(connection("api").textContent).toContain("Needs ANTHROPIC_API_KEY · none found");
    });
  });

  describe("save ordering across the two routes", () => {
    it("writes PUT /api/llm/config before PUT /api/hench/config", async () => {
      const api = stubApi({ config: config("claude"), henchProvider: "cli" });
      await mount();

      await pickConnection("api");
      await choose(select("agent.claude")!, "claude-opus-5");
      await save();

      expect(api.puts().map((c) => c.url)).toEqual(["/api/llm/config", "/api/hench/config"]);
      expect(api.puts()[0].body).toEqual({ changes: { "hench.models.claude": "claude-opus-5" } });
      expect(api.puts()[1].body).toEqual({ changes: { provider: "api" } });
    });

    it("sends only the hench write for a provider-only change", async () => {
      const api = stubApi({ config: config("claude"), henchProvider: "cli" });
      await mount();

      await pickConnection("api");
      await save();

      expect(api.puts().map((c) => c.url)).toEqual(["/api/hench/config"]);
    });

    it("saves the vendor switch first so the hench route validates provider against it", async () => {
      const api = stubApi({ config: config("claude"), henchProvider: "api" });
      await mount();

      await act(async () => { card("codex").click(); });
      await save();

      // codex is cli-only and the saved provider is api, so the page moves it to cli.
      expect(api.puts().map((c) => c.url)).toEqual(["/api/llm/config", "/api/hench/config"]);
      expect(api.puts()[0].body).toEqual({ changes: { "llm.vendor": "codex" } });
      expect(api.puts()[1].body).toEqual({ changes: { provider: "cli" } });
    });

    it("after the second write fails, the llm part is clean and the provider stays dirty with its error", async () => {
      const api = stubApi({ config: config("claude"), henchProvider: "cli", failHench: true });
      await mount();

      await pickConnection("api");
      await choose(select("agent.claude")!, "claude-opus-5");
      await save();

      expect(api.puts()).toHaveLength(2);
      expect(root.querySelector(".settings-frame-indicator")?.textContent).toBe("Unsaved changes");
      expect(root.textContent).toContain('Provider "api" is not supported for vendor "codex".');
      expect(root.querySelector(".llm-field-dirty .llm-connection-cards")).not.toBeNull();
      expect(root.querySelector(`.llm-field-dirty select[id="agent.claude"]`)).toBeNull();

      // A retry sends the provider alone: the model write is not repeated.
      await save();
      expect(api.puts().slice(2).map((c) => c.url)).toEqual(["/api/hench/config"]);
    });
  });
});
