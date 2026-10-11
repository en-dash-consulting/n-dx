// @vitest-environment jsdom
/**
 * Robot Wrangler run card: what the next `ndx work` run will use. It renders
 * the route's resolution (saved, or the preview while edits are unsaved) and
 * applies no rules of its own.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { RobotWranglerView } from "../../../src/viewer/views/robot-wrangler.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

type Json = Record<string, unknown>;

function effective(vendor: string, model: string, over: Json = {}): Json {
  return { vendor, provider: "cli", model, modelSource: "default", ...over };
}

function config(over: Json = {}): Json {
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
    agentModels: {},
    effective: effective("claude", "claude-sonnet-5"),
    effectiveProblems: [],
    tiers: [{ tier: "agent", model: "claude-sonnet-5", source: "hench.models.claude", usedBy: [{ label: "ndx work" }] }],
    ...over,
  };
}

const CATALOG: Json = {
  claude: { models: ["claude-sonnet-5"], providers: ["cli", "api"], defaultModel: "claude-sonnet-5", source: "live", checkedAt: "2026-10-01T12:00:00.000Z", cli: { found: true, version: "2.1.0", path: "/bin/claude" } },
  codex: { models: ["gpt-5.6-sol"], providers: ["cli"], defaultModel: "gpt-5.6-sol", source: "built-in", checkedAt: null, cli: { found: false, version: null, path: null }, readiness: { state: "needs-setup", summary: "CLI not found" } },
  google: { models: ["gemini-2.5-pro"], providers: ["api"], defaultModel: "gemini-2.5-pro", source: "built-in", checkedAt: null },
  local: { models: [], providers: ["api"], defaultModel: "", reachable: false },
};

interface Api {
  calls: Array<{ method: string; url: string; body?: Json }>;
  previews: () => Json[];
}

/** Serves config, catalog and auth; `preview` answers POST /api/llm/config/preview. */
function stubApi(opts: { config: Json; preview?: Json; auth?: Json; authPending?: boolean }): Api {
  const calls: Api["calls"] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ method, url: u, body: init?.body ? JSON.parse(init.body) as Json : undefined });
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
    if (u.includes("/api/commands/auth")) {
      if (opts.authPending) return new Promise(() => {});
      return ok(opts.auth ?? { ok: true, output: "claude: credentials OK", error: null });
    }
    if (u.includes("/api/llm/catalog")) return ok(CATALOG);
    if (u.includes("/api/llm/config/preview")) return ok(opts.preview ?? opts.config);
    if (u.includes("/api/llm/config")) return ok(method === "PUT" ? { config: opts.config } : opts.config);
    return ok({});
  }));
  return { calls, previews: () => calls.filter((c) => c.url.includes("/config/preview")).map((c) => c.body ?? {}) };
}

async function settle(ms = 10) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

describe("Robot Wrangler run card", () => {
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

  const card = () => root.querySelector(".llm-runcard")!;
  const chips = () => Array.from(root.querySelectorAll(".llm-runcard-chip")).map((c) => c.textContent);
  const vendorCard = (v: string) => root.querySelector<HTMLButtonElement>(`.llm-vendor-card-${v}`)!;

  it("shows the effective model, vendor, provider, source and review chip when ready", async () => {
    stubApi({
      config: config({
        effective: effective("claude", "claude-opus-5", { modelSource: "hench-override" }),
        review: {
          mode: { value: "self" }, vendor: { value: null }, rounds: { value: 2 },
          models: { claude: { model: "claude-opus-5", source: "vendor-default" } },
          available: true, pairSupported: false,
        },
      }),
    });
    await mount();

    expect(card().querySelector(".llm-runcard-model-id")?.textContent).toBe("claude-opus-5");
    expect(chips()).toEqual(["Claude", "via cli", "model from hench.models.claude", "Self review · claude-opus-5"]);
    expect(card().textContent).toContain("NEXT n-dx work RUN");
    expect(card().textContent).toContain("A task's saved run settings (Prepare task) or a --model flag can override this for that run.");
    expect(card().classList.contains("llm-runcard-refused")).toBe(false);
    expect(root.querySelector(".llm-runcard-badge")).toBeNull();
    expect(root.querySelector(".llm-runcard-banner")).toBeNull();

    const checks = root.querySelector(".llm-runcard-checks")!.textContent!;
    expect(checks).toContain("Credentials valid");
    expect(checks).toContain("CLI 2.1.0");
    expect(checks).toContain("Live model list");
  });

  it("keeps each checklist label short and puts the long detail in a tooltip and a second line", async () => {
    stubApi({ config: config(), auth: { ok: true, output: "claude: credentials OK via llm.claude.api_key", error: null } });
    await mount();

    const rows = Array.from(root.querySelectorAll<HTMLElement>(".llm-runcard-check"));
    const label = (i: number) => rows[i].querySelector(".llm-runcard-check-label")?.textContent;
    expect(label(0)).toBe("Credentials valid");
    expect(rows[0].title).toBe("claude: credentials OK via llm.claude.api_key");
    expect(rows[0].querySelector(".llm-runcard-check-detail")?.textContent).toBe("claude: credentials OK via llm.claude.api_key");
    expect(label(1)).toBe("CLI 2.1.0");
    expect(label(2)).toBe("Live model list");
  });

  it("uses the preview's failover block while edits are pending", async () => {
    stubApi({
      config: config({ failover: { enabled: false, applies: true, reason: null, chain: ["claude-sonnet-5", "claude-opus-5"] } }),
      preview: config({
        vendor: "codex",
        effective: effective("codex", "gpt-5.6-sol"),
        failover: { enabled: false, applies: false, reason: "Failover is not available for Codex.", chain: ["gpt-5.6-sol"] },
      }),
    });
    await mount();
    expect(root.querySelector(".llm-failover-warning")).toBeNull();
    expect(Array.from(root.querySelectorAll(".llm-failover-pill")).map((p) => p.textContent)).toEqual(["claude-sonnet-5", "claude-opus-5"]);

    await act(async () => { vendorCard("codex").click(); });
    await settle(350);

    expect(root.querySelector(".llm-failover-warning")?.textContent).toContain("Failover is not available for Codex.");
    expect(Array.from(root.querySelectorAll(".llm-failover-pill")).map((p) => p.textContent)).toEqual(["gpt-5.6-sol"]);
  });

  it("names the pair reviewer and its model", async () => {
    stubApi({
      config: config({
        review: {
          mode: { value: "pair" }, vendor: { value: "codex" }, rounds: { value: 2 },
          models: { codex: { model: "gpt-5.6-sol", source: "vendor-default" } },
          available: true, pairSupported: true,
        },
      }),
    });
    await mount();
    expect(chips()).toContain("Reviewed by Codex · gpt-5.6-sol");
  });

  it("previews unsaved edits with an After save badge and the saved model struck through, writing nothing", async () => {
    const api = stubApi({
      config: config(),
      preview: config({
        vendor: "google",
        effective: effective("google", "gemini-2.5-pro", { provider: "api" }),
        tiers: [{ tier: "agent", model: "gemini-2.5-pro", source: "catalog default", usedBy: [] }],
      }),
    });
    await mount();
    await act(async () => { vendorCard("google").click(); });
    // Debounced: nothing is asked until the edits settle.
    expect(api.previews()).toHaveLength(0);
    await settle(350);

    expect(api.previews()).toEqual([{ changes: { "llm.vendor": "google" } }]);
    expect(card().querySelector(".llm-runcard-model-id")?.textContent).toBe("gemini-2.5-pro");
    expect(card().querySelector(".llm-runcard-prev")?.tagName).toBe("S");
    expect(card().querySelector(".llm-runcard-prev")?.textContent).toBe("claude-sonnet-5");
    expect(card().querySelector(".llm-runcard-badge")?.textContent).toBe("After save");
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("returns to the saved config when the edits are discarded", async () => {
    stubApi({ config: config(), preview: config({ effective: effective("google", "gemini-2.5-pro", { provider: "api" }) }) });
    await mount();
    await act(async () => { vendorCard("google").click(); });
    await settle(350);
    expect(root.querySelector(".llm-runcard-badge")).toBeTruthy();

    await act(async () => { vendorCard("claude").click(); });
    await settle();
    expect(root.querySelector(".llm-runcard-badge")).toBeNull();
    expect(card().querySelector(".llm-runcard-model-id")?.textContent).toBe("claude-sonnet-5");
  });

  it("shows the banner with the server's message for a refused configuration, and never offers an API switch for Codex", async () => {
    stubApi({
      config: config({
        vendor: "codex",
        effective: effective("codex", "gpt-5.6-sol", { provider: "api" }),
        effectiveProblems: [{ field: "provider", message: 'Provider "api" is not supported for vendor "codex". Allowed: cli.' }],
      }),
    });
    await mount();

    expect(card().classList.contains("llm-runcard-refused")).toBe(true);
    const banner = root.querySelector('.llm-runcard-banner[role="alert"]')!;
    expect(banner.textContent).toContain("n-dx work would refuse this.");
    expect(banner.textContent).toContain('Provider "api" is not supported for vendor "codex". Allowed: cli.');
    expect(banner.textContent).toContain("Codex runs on its CLI only.");
    expect(banner.textContent).not.toMatch(/\bAPI\b.*(switch|use|connection)|use the api/i);
    expect(root.querySelector(".llm-connection-card-api")).toBeNull();
  });

  it("offers How to install and pick another vendor when the Codex CLI is missing", async () => {
    stubApi({ config: config({ vendor: "codex", effective: effective("codex", "gpt-5.6-sol") }) });
    await mount();

    const banner = root.querySelector(".llm-runcard-banner")!;
    expect(banner.textContent).toContain("CLI not found");
    const link = banner.querySelector<HTMLAnchorElement>("a")!;
    expect(link.textContent).toBe("How to install");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(Array.from(banner.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["pick another vendor"]);
  });

  it("shows placeholder rows while the checks are pending", async () => {
    stubApi({ config: config(), authPending: true });
    await mount();
    expect(root.querySelector('.llm-runcard-placeholder[aria-label="Credentials"]')).toBeTruthy();
    expect(root.querySelector(".llm-runcard-checks")!.textContent).not.toContain("Credentials valid");
  });

  it("reports failed credentials with a re-run action that forces a fresh check", async () => {
    const api = stubApi({ config: config(), auth: { ok: false, output: "", error: "No API key found for vendor claude" } });
    await mount();

    expect(root.querySelector(".llm-runcard-check-bad")!.textContent).toContain("Credentials failed");
    expect(root.textContent).toContain("No API key found");
    const button = Array.from(root.querySelectorAll(".llm-runcard-checks button")).find((b) => b.textContent === "Re-run n-dx auth")!;
    await act(async () => { (button as HTMLButtonElement).click(); });
    await settle();
    expect(api.calls.some((c) => c.url.includes("/api/commands/auth?refresh=true"))).toBe(true);
  });

  it("shows the legacy-key info line inside the card", async () => {
    stubApi({ config: config({ claudeSources: { model: "legacy" } }) });
    await mount();
    expect(card().querySelector(".llm-legacy")?.textContent).toContain("claude.model is read from the legacy top-level key");
  });
});
