// @vitest-environment jsdom
/**
 * Robot Wrangler with the Local vendor selected: Section 2 becomes "Server"
 * (profiles, host/port with Test connection, live status), the tier table lists
 * the server's live models with Primary / Light wording, and the advanced
 * settings sit in collapsed rows that show their current value. Every field the
 * old page edited still saves to the same key.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { RobotWranglerView } from "../../../src/viewer/views/robot-wrangler.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

type Json = Record<string, unknown>;

const LIVE_MODELS = ["qwen3-coder-30b", "llama-3.3-70b", "gemma-3-12b"];

const PROFILES = [
  { name: "Studio", host: "localhost", port: 1234, model: "qwen3-coder-30b" },
  { name: "Ollama", host: "127.0.0.1", port: 11434, model: "llama-3.3-70b" },
];

function localConfig(local: Json = {}, overrides: Json = {}): Json {
  const row = (tier: string, source: string, labels: string[], model = "qwen3-coder-30b") => ({
    tier, model, source, usedBy: labels.map((label) => ({ label })),
  });
  return {
    vendor: "local",
    claude: { model: null, lightModel: null },
    codex: { model: null, lightModel: null },
    google: { model: null, lightModel: null },
    local: {
      model: "qwen3-coder-30b", lightModel: null, host: "localhost", port: 1234,
      maxContextTokens: null, timeoutMs: null,
      verifier: { host: null, port: null, model: null, maxCycles: null },
      ...local,
    },
    claudeSources: {},
    agentModels: {},
    effective: { vendor: "local", provider: "api", model: "qwen3-coder-30b", modelSource: "default" },
    effectiveProblems: [],
    tiers: [
      row("agent", "llm.local.model", ["ndx work"]),
      row("standard", "llm.local.model", ["ndx plan"]),
      row("light", "llm.local.model", ["summaries"]),
      row("heavy", "llm.local.model", []),
    ],
    failover: { enabled: false, applies: false, reason: "Failover is not available for local models.", chain: [] },
    ...overrides,
  };
}

const CATALOG: Json = {
  claude: { models: [], providers: ["cli", "api"], defaultModel: "", source: "built-in", checkedAt: null, cli: { found: false, version: null, path: null } },
  codex: { models: [], providers: ["cli"], defaultModel: "", source: "built-in", checkedAt: null, cli: { found: false, version: null, path: null } },
  google: { models: [], providers: ["api"], defaultModel: "", source: "built-in", checkedAt: null },
  local: { models: LIVE_MODELS, providers: ["api"], defaultModel: "", reachable: true, readiness: { state: "ready", summary: "Ready" } },
};

interface Call { method: string; url: string; body?: Json }

function stubApi(opts: {
  config: Json;
  profiles?: Json[];
  status?: Json;
  test?: Json;
}) {
  const calls: Call[] = [];
  const mock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) as Json : undefined;
    const u = String(url);
    calls.push({ method, url: u, body });
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
    if (u.includes("/api/llm/catalog")) return ok(CATALOG);
    if (u.includes("/api/llm/local-status")) {
      return ok(opts.status ?? { ok: true, url: "http://localhost:1234", models: LIVE_MODELS });
    }
    if (u.includes("/api/llm/local-test")) {
      return ok(opts.test ?? { ok: true, latencyMs: 412, tokensPerSecond: 38, outputTokens: 2, reply: "OK", url: "", modelCount: 3 });
    }
    if (u.includes("/api/llm/local-profiles")) return ok({ profiles: opts.profiles ?? PROFILES });
    if (u.includes("/api/llm/config/preview")) return ok(opts.config);
    if (u.includes("/api/llm/config")) return ok(method === "PUT" ? { applied: [], config: opts.config } : opts.config);
    if (u.includes("/api/hench/config")) return ok({ config: { provider: "api" } });
    return ok({});
  });
  vi.stubGlobal("fetch", mock);
  return {
    calls,
    puts: () => calls.filter((c) => c.method === "PUT" && c.url === "/api/llm/config"),
    count: (fragment: string) => calls.filter((c) => c.url.includes(fragment)).length,
  };
}

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

describe("Robot Wrangler — Local vendor layout", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    clearProjectMetadataCache();
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function mount() {
    act(() => { render(h(RobotWranglerView, null), root); });
    await settle();
  }

  const input = (id: string) => root.querySelector<HTMLInputElement>(`input[id="${id}"]`)!;
  const select = (id: string) => root.querySelector<HTMLSelectElement>(`select[id="${id}"]`)!;
  const sections = () => Array.from(root.querySelectorAll<HTMLElement>(".llm-rw-section"));
  const section = (title: string) =>
    sections().find((s) => s.querySelector(".llm-rw-section-title")?.textContent?.endsWith(title))!;
  const advanced = () => Array.from(root.querySelectorAll<HTMLDetailsElement>("details.llm-adv"));
  const summary = (d: HTMLDetailsElement) => d.querySelector("summary")!.textContent!.replace(/\s+/g, " ").trim();
  const chips = () => Array.from(root.querySelectorAll<HTMLButtonElement>(".llm-profile-chip-apply"));

  async function type(el: HTMLInputElement, value: string) {
    await act(async () => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function save() {
    await act(async () => { root.querySelector<HTMLButtonElement>(".settings-frame-save")!.click(); });
    await settle();
  }

  it("makes Section 2 the Server section, in place of Connection", async () => {
    stubApi({ config: localConfig() });
    await mount();
    const titles = sections().map((s) => s.querySelector(".llm-rw-section-title")?.textContent);
    expect(titles.slice(0, 3)).toEqual(["1Vendor", "2Server", "3Models"]);
    expect(section("Server").querySelector(".llm-rw-section-subtitle")?.textContent)
      .toBe("Where your local models are served");
    expect(root.querySelector(".llm-connection-card-api")).toBeNull();
  });

  it("shows the live status inside the Server section and re-checks it every 10 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const api = stubApi({ config: localConfig() });
    await mount();
    expect(section("Server").querySelector(".llm-status-pill")?.textContent).toContain("3 models available");
    const before = api.count("local-status");
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(api.count("local-status")).toBe(before + 1);
  });

  describe("profiles", () => {
    it("lists the saved profiles as chips and highlights the one in use", async () => {
      stubApi({ config: localConfig() });
      await mount();
      expect(chips().map((c) => c.textContent)).toEqual(["Studio", "Ollama"]);
      expect(chips().map((c) => c.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
      expect(section("Server").textContent).toContain("+ Save current as profile");
    });

    it("applies a profile as unsaved host, port and model edits", async () => {
      const api = stubApi({ config: localConfig() });
      await mount();
      await act(async () => { chips()[1].click(); });
      expect(input("local.host").value).toBe("127.0.0.1");
      expect(input("local.port").value).toBe("11434");
      expect(select("local.model").value).toBe("llama-3.3-70b");
      expect(chips().map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "true"]);

      await save();
      expect(api.puts()[0].body).toEqual({
        changes: { "llm.local.host": "127.0.0.1", "llm.local.port": "11434", "llm.local.model": "llama-3.3-70b" },
      });
    });

    it("saves the current host, port and model under a name", async () => {
      const api = stubApi({ config: localConfig() });
      await mount();
      await act(async () => {
        section("Server").querySelector<HTMLButtonElement>(".llm-profiles-new-btn")!.click();
      });
      await type(section("Server").querySelector<HTMLInputElement>(".llm-profiles-save-row input")!, "Desk");
      await act(async () => {
        section("Server").querySelector<HTMLButtonElement>(".llm-profiles-save-row .llm-btn-primary")!.click();
      });
      await settle();
      const post = api.calls.find((c) => c.method === "POST" && c.url.includes("local-profiles"))!;
      expect(post.body).toEqual({ name: "Desk", host: "localhost", port: 1234, model: "qwen3-coder-30b" });
    });
  });

  describe("host, port and Test connection", () => {
    it("edits host and port, which save to llm.local.host and llm.local.port", async () => {
      const api = stubApi({ config: localConfig() });
      await mount();
      expect(input("local.host").value).toBe("localhost");
      expect(input("local.port").value).toBe("1234");
      await type(input("local.host"), "10.0.0.5");
      await type(input("local.port"), "8080");
      await save();
      expect(api.puts()[0].body).toEqual({ changes: { "llm.local.host": "10.0.0.5", "llm.local.port": "8080" } });
    });

    it("reports the connection, model count, reply time and speed", async () => {
      const api = stubApi({ config: localConfig() });
      await mount();
      await type(input("local.port"), "8080");
      await act(async () => {
        section("Server").querySelector<HTMLButtonElement>(".llm-smoke-row .llm-btn")!.click();
      });
      await settle();
      expect(section("Server").querySelector(".llm-smoke-ok")?.textContent)
        .toBe("Connected · 3 models · reply in 412 ms · 38 tok/s");
      // The test runs against the edits, not the saved config.
      const test = api.calls.find((c) => c.url.includes("local-test"))!;
      expect(test.body).toMatchObject({ host: "localhost", port: 8080 });
    });

    it("leaves out what the server could not measure", async () => {
      stubApi({
        config: localConfig(),
        test: { ok: true, latencyMs: 90, tokensPerSecond: null, outputTokens: null, reply: "OK", url: "", modelCount: 1 },
      });
      await mount();
      await act(async () => {
        section("Server").querySelector<HTMLButtonElement>(".llm-smoke-row .llm-btn")!.click();
      });
      await settle();
      expect(section("Server").querySelector(".llm-smoke-ok")?.textContent)
        .toBe("Connected · 1 model · reply in 90 ms");
    });

    it("shows the error when the test fails", async () => {
      stubApi({
        config: localConfig(),
        test: { ok: false, latencyMs: 5, tokensPerSecond: null, outputTokens: null, reply: null, error: "Connection refused — is LM Studio running?", url: "", modelCount: null },
      });
      await mount();
      await act(async () => {
        section("Server").querySelector<HTMLButtonElement>(".llm-smoke-row .llm-btn")!.click();
      });
      await settle();
      expect(section("Server").querySelector(".llm-smoke-err")?.textContent)
        .toBe("✕ Connection refused — is LM Studio running?");
    });

    it("drops a result once host or port changes, since it describes another server", async () => {
      stubApi({ config: localConfig() });
      await mount();
      await act(async () => {
        section("Server").querySelector<HTMLButtonElement>(".llm-smoke-row .llm-btn")!.click();
      });
      await settle();
      expect(section("Server").querySelector(".llm-smoke-ok")).not.toBeNull();
      await type(input("local.host"), "10.0.0.5");
      expect(section("Server").querySelector(".llm-smoke-ok")).toBeNull();
    });
  });

  describe("models", () => {
    it("labels Standard as Primary and says Light falls back to it", async () => {
      stubApi({ config: localConfig() });
      await mount();
      const models = section("Models");
      const labels = Array.from(models.querySelectorAll(".llm-tier-name .llm-field-label")).map((l) => l.textContent);
      expect(labels).toContain("Primary");
      expect(labels).not.toContain("Standard");
      const light = models.querySelector(".llm-tier-row-light")!;
      expect(light.textContent).toContain("Falls back to Primary");
      expect(light.querySelector("select")!.options[0].textContent).toBe("Same as Primary");
    });

    it("offers the server's live models for Primary and Light", async () => {
      stubApi({ config: localConfig() });
      await mount();
      const values = (el: HTMLSelectElement) => Array.from(el.options).map((o) => o.value);
      expect(values(select("local.model"))).toEqual(["", ...LIVE_MODELS, "__other__"]);
      expect(values(select("local.lightModel"))).toEqual(["", ...LIVE_MODELS, "__other__"]);
    });
  });

  describe("advanced settings", () => {
    it("holds three collapsed rows, each summarising its current value", async () => {
      stubApi({
        config: localConfig({
          maxContextTokens: 32768,
          timeoutMs: 7_200_000,
          verifier: { host: "localhost", port: 1235, model: "gemma-3-12b", maxCycles: 3 },
        }),
      });
      await mount();
      const rows = advanced();
      expect(rows.map((d) => d.open)).toEqual([false, false, false]);
      expect(rows.map(summary)).toEqual([
        "Context budget 32768 tokens",
        "Request timeout 2 h",
        "Second-model verifier localhost:1235 · gemma-3-12b · 3 review cycles",
      ]);
    });

    it("says so when nothing is set", async () => {
      stubApi({ config: localConfig() });
      await mount();
      expect(advanced().map(summary)).toEqual([
        "Context budget Not set",
        "Request timeout 5 min (default)",
        "Second-model verifier Off",
      ]);
    });

    it("reads 0 as no limit", async () => {
      stubApi({ config: localConfig({ timeoutMs: 0 }) });
      await mount();
      expect(summary(advanced()[1])).toBe("Request timeout No limit");
    });

    it("keeps the summary in step with unsaved edits", async () => {
      stubApi({ config: localConfig() });
      await mount();
      await type(input("local.maxContextTokens"), "8192");
      expect(summary(advanced()[0])).toContain("8192 tokens");
    });

    it("keeps every advanced field editable and saving to the same key", async () => {
      const api = stubApi({ config: localConfig() });
      await mount();
      await type(input("local.maxContextTokens"), "32768");
      await type(input("local.timeoutMs"), "0");
      await type(input("local.verifier.host"), "localhost");
      await type(input("local.verifier.port"), "1235");
      await type(input("local.verifier.model"), "gemma-3-12b");
      await type(input("local.verifier.maxCycles"), "3");
      await save();
      expect(api.puts()[0].body).toEqual({
        changes: {
          "llm.local.maxContextTokens": "32768",
          "llm.local.timeoutMs": "0",
          "llm.local.verifier.host": "localhost",
          "llm.local.verifier.port": "1235",
          "llm.local.verifier.model": "gemma-3-12b",
          "llm.local.verifier.maxCycles": "3",
        },
      });
    });

    it("marks a row that holds an unsaved edit", async () => {
      stubApi({ config: localConfig() });
      await mount();
      await type(input("local.verifier.port"), "1235");
      expect(advanced().map((d) => d.querySelector(".llm-dirty-dot") !== null)).toEqual([false, false, true]);
    });
  });
});
