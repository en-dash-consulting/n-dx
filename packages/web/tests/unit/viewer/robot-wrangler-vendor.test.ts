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
    },
    codex: {
      models: ["gpt-5.5", "gpt-5.6-sol"], providers: ["cli"], defaultModel: "gpt-5.5",
      source: "built-in", checkedAt: null, reason: "No OPENAI_API_KEY", cli: { found: false, version: null, path: null },
    },
    google: {
      models: ["gemini-2.5-pro", "gemini-3.7-flash"], providers: ["api"], defaultModel: "gemini-2.5-pro",
      source: "built-in", checkedAt: null, reason: "No live model list for google",
    },
    local: { models: ["qwen3-coder-30b"], providers: ["api"], defaultModel: "qwen3-coder-30b", reachable: true },
    ...overrides,
  };
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

  describe.each(VENDORS)("%s", (vendor) => {
    it("offers exactly the providers the catalog lists, fixed when there is one", async () => {
      stubApi({ config: config(vendor) });
      await mount();
      const providers = (catalog()[vendor] as { providers: string[] }).providers;

      const dropdown = select("provider");
      if (providers.length === 1) {
        expect(dropdown).toBeNull();
        expect(root.querySelector("#provider")?.textContent).toBe(providers[0]);
      } else {
        expect(optionValues(dropdown!)).toEqual(providers);
      }
    });

    it("lists the catalog models for the agent, project and light model, and nothing else", async () => {
      stubApi({ config: config(vendor) });
      await mount();
      const models = (catalog()[vendor] as { models: string[] }).models;

      const agent = select(`agent.${vendor}`)!;
      expect(optionValues(agent)).toEqual(["", ...models, "__other__"]);

      if (vendor !== "local") {
        for (const field of ["model", "lightModel"]) {
          expect(optionValues(select(`${vendor}.${field}`)!)).toEqual(["", ...models, "__other__"]);
        }
      }
    });

    it("marks the project default, offers 'Use project default' first and 'Other model…' last", async () => {
      stubApi({ config: config(vendor) });
      await mount();
      const { defaultModel, models } = catalog()[vendor] as { defaultModel: string; models: string[] };

      const labels = optionLabels(select(`agent.${vendor}`)!);
      expect(labels[0]).toBe(`Use project default (${defaultModel})`);
      expect(labels[labels.length - 1]).toBe("Other model…");
      expect(labels).toContain(`${defaultModel} (project default)`);
      expect(labels.filter((l) => l?.includes("(project default)"))).toHaveLength(models.includes(defaultModel) ? 1 : 0);
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

    it("saves a free-entry agent model typed under 'Other model…'", async () => {
      const api = stubApi({ config: config(vendor) });
      await mount();

      await choose(select(`agent.${vendor}`)!, "__other__");
      const input = root.querySelector<HTMLInputElement>(`input[id="agent.${vendor}-other"]`)!;
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

    const status = root.querySelector(".llm-catalog-status")!;
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
    expect(root.querySelector(".llm-catalog-origin")?.textContent).toBe("Built-in list — No OPENAI_API_KEY");
  });

  it("reports the installed CLI for claude and codex, with no update or install action", async () => {
    stubApi({ config: config("claude") });
    await mount();
    expect(root.querySelector(".llm-catalog-cli")?.textContent).toBe("CLI 2.1.0");

    await act(async () => { root.querySelector<HTMLButtonElement>(".llm-vendor-tab-codex")!.click(); });
    expect(root.querySelector(".llm-catalog-cli")?.textContent).toBe("CLI not found");

    const buttons = Array.from(root.querySelectorAll(".llm-catalog-status button")).map((b) => b.textContent);
    expect(buttons).toEqual(["Refresh models"]);
    expect(root.textContent).not.toMatch(/\b(update|install)\b CLI|Install |Update /);
  });

  it("shows no CLI line for google or local", async () => {
    stubApi({ config: config("google") });
    await mount();
    expect(root.querySelector(".llm-catalog-cli")).toBeNull();
  });

  it("changes what the page offers when the vendor changes, with no stale options and no reload", async () => {
    const api = stubApi({ config: config("claude") });
    await mount();
    expect(optionValues(select("agent.claude")!)).toContain("claude-opus-5");

    await act(async () => { root.querySelector<HTMLButtonElement>(".llm-vendor-tab-codex")!.click(); });

    expect(select("agent.claude")).toBeNull();
    expect(optionValues(select("agent.codex")!)).toEqual(["", "gpt-5.5", "gpt-5.6-sol", "__other__"]);
    expect(optionValues(select("agent.codex")!)).not.toContain("claude-opus-5");
    expect(select("provider")).toBeNull();
    expect(root.querySelector("#provider")?.textContent).toBe("cli");
    expect(api.calls.filter((c) => c.url.includes("/api/llm/catalog"))).toHaveLength(1);
  });

  it("keeps a stored model the list lacks as its own option", async () => {
    stubApi({ config: config("claude", { claude: { model: "claude-legacy-1", lightModel: null } }) });
    await mount();
    const el = select("claude.model")!;
    expect(el.value).toBe("claude-legacy-1");
    expect(optionValues(el)).toContain("claude-legacy-1");
  });

  it("uses no model list of its own: the viewer source names no model id", () => {
    // Vitest runs from packages/web; jsdom's URL cannot build a file: URL here.
    const src = readFileSync(join(process.cwd(), "src/viewer/views/robot-wrangler.ts"), "utf-8");
    expect(src).not.toContain("MODEL_SUGGESTIONS");
    expect(src).not.toMatch(/["'`](claude-(sonnet|opus|haiku|fable)|gpt-5|gemini-)/);
  });

  describe("save ordering across the two routes", () => {
    it("writes PUT /api/llm/config before PUT /api/hench/config", async () => {
      const api = stubApi({ config: config("claude"), henchProvider: "cli" });
      await mount();

      await choose(select("provider")!, "api");
      await choose(select("agent.claude")!, "claude-opus-5");
      await save();

      expect(api.puts().map((c) => c.url)).toEqual(["/api/llm/config", "/api/hench/config"]);
      expect(api.puts()[0].body).toEqual({ changes: { "hench.models.claude": "claude-opus-5" } });
      expect(api.puts()[1].body).toEqual({ changes: { provider: "api" } });
    });

    it("sends only the hench write for a provider-only change", async () => {
      const api = stubApi({ config: config("claude"), henchProvider: "cli" });
      await mount();

      await choose(select("provider")!, "api");
      await save();

      expect(api.puts().map((c) => c.url)).toEqual(["/api/hench/config"]);
    });

    it("saves the vendor switch first so the hench route validates provider against it", async () => {
      const api = stubApi({ config: config("claude"), henchProvider: "api" });
      await mount();

      await act(async () => { root.querySelector<HTMLButtonElement>(".llm-vendor-tab-codex")!.click(); });
      await save();

      // codex is cli-only and the saved provider is api, so the page moves it to cli.
      expect(api.puts().map((c) => c.url)).toEqual(["/api/llm/config", "/api/hench/config"]);
      expect(api.puts()[0].body).toEqual({ changes: { "llm.vendor": "codex" } });
      expect(api.puts()[1].body).toEqual({ changes: { provider: "cli" } });
    });

    it("after the second write fails, the llm part is clean and the provider stays dirty with its error", async () => {
      const api = stubApi({ config: config("claude"), henchProvider: "cli", failHench: true });
      await mount();

      await choose(select("provider")!, "api");
      await choose(select("agent.claude")!, "claude-opus-5");
      await save();

      expect(api.puts()).toHaveLength(2);
      expect(root.querySelector(".settings-frame-indicator")?.textContent).toBe("Unsaved changes");
      expect(root.textContent).toContain('Provider "api" is not supported for vendor "codex".');
      expect(root.querySelector(".llm-field-dirty #provider, .llm-field-dirty select#provider")).not.toBeNull();
      expect(root.querySelector(`.llm-field-dirty select[id="agent.claude"]`)).toBeNull();

      // A retry sends the provider alone: the model write is not repeated.
      await save();
      expect(api.puts().slice(2).map((c) => c.url)).toEqual(["/api/hench/config"]);
    });
  });
});
