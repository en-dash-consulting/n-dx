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
    ...overrides,
  };
}

/** Serves GET /api/llm/config and records PUT bodies; everything else is empty. */
function stubApi(initial: Json) {
  const puts: Json[] = [];
  const mock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
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

  it("shows the effective block as runnable when there are no problems", async () => {
    stubApi(config({
      effective: { vendor: "claude", provider: "cli", model: "claude-opus-5", modelSource: "hench-override" },
    }));
    await mount();
    const block = root.querySelector(".llm-effective")!;
    expect(block.textContent).toContain("claude");
    expect(block.textContent).toContain("cli");
    expect(block.textContent).toContain("claude-opus-5");
    expect(block.textContent).toContain("agent model override");
    expect(block.classList.contains("llm-effective-refused")).toBe(false);
    expect(block.querySelector('[role="alert"]')).toBeNull();
  });

  it("marks the block refused and lists the route's provider problem", async () => {
    stubApi(config({
      vendor: "codex",
      effective: { vendor: "codex", provider: "api", model: "gpt-5.5", modelSource: "default" },
      effectiveProblems: [{ field: "provider", message: 'Provider "api" is not supported for vendor "codex". Allowed: cli.' }],
    }));
    await mount();
    const block = root.querySelector(".llm-effective")!;
    expect(block.classList.contains("llm-effective-refused")).toBe(true);
    const items = Array.from(block.querySelectorAll('[role="alert"] li')).map((li) => li.textContent);
    expect(items).toEqual(['Provider "api" is not supported for vendor "codex". Allowed: cli.']);
  });

  it("marks the block refused and lists the route's model problem", async () => {
    stubApi(config({
      vendor: "codex",
      effective: { vendor: "codex", provider: "cli", model: "claude-sonnet-4-6", modelSource: "configured" },
      effectiveProblems: [{ field: "model", message: 'Model "claude-sonnet-4-6" is not a codex model.' }],
    }));
    await mount();
    const items = Array.from(root.querySelectorAll('.llm-effective [role="alert"] li')).map((li) => li.textContent);
    expect(items).toEqual(['Model "claude-sonnet-4-6" is not a codex model.']);
  });

  it("shows legacy-key Claude fields as such and saves them to llm.claude.*", async () => {
    const { puts } = stubApi(config({
      claude: { model: "claude-opus-5", lightModel: "claude-haiku-4-5" },
      claudeSources: { model: "legacy", lightModel: "legacy" },
    }));
    await mount();

    const model = root.querySelector<HTMLInputElement>('input[id="claude.model"]')!;
    const light = root.querySelector<HTMLInputElement>('input[id="claude.lightModel"]')!;
    expect(model.value).toBe("claude-opus-5");
    expect(light.value).toBe("claude-haiku-4-5");
    const sources = Array.from(root.querySelectorAll(".llm-field-source")).map((el) => el.textContent?.trim());
    expect(sources).toEqual(["from legacy claude.model", "from legacy claude.lightModel"]);

    await act(async () => {
      model.value = "claude-sonnet-5";
      model.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(root.querySelector(".settings-frame-indicator")?.textContent).toBe("Unsaved changes");

    await act(async () => { root.querySelector<HTMLButtonElement>(".settings-frame-save")!.click(); });
    await settle();
    expect(puts).toEqual([{ changes: { "llm.claude.model": "claude-sonnet-5" } }]);
  });

  it("shows no legacy marker when the fields come from llm.claude.*", async () => {
    stubApi(config({
      claude: { model: "claude-opus-5", lightModel: null },
      claudeSources: { model: "llm" },
    }));
    await mount();
    expect(root.querySelectorAll(".llm-field-source")).toHaveLength(0);
  });
});
