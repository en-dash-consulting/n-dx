// @vitest-environment jsdom
/**
 * Settings pages must not wait on the analysis-data load.
 *
 * main.ts hands `SettingsOverlay` the output of `renderViewContent(view,
 * loading, ctx)`. These tests render that exact pairing with `loading: true`
 * and an empty `data`, as the app does before sourcevision has loaded: each
 * settings page shows its own content, while an analysis view still shows the
 * loading state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { SettingsOverlay } from "../../../src/viewer/components/settings-overlay.js";
import { renderViewContent, type ViewRenderContext } from "../../../src/viewer/views/view-registry.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import { buildValidViews } from "../../../src/shared/index.js";
import type { LoadedData, ViewId } from "../../../src/viewer/types.js";

const ctx = {
  data: {} as LoadedData,
  navigateTo: vi.fn(),
  jobs: { operations: [], refresh: async () => {}, stop: async () => {} },
} as unknown as ViewRenderContext;

const VALID = buildValidViews(null);

const LLM_CONFIG = {
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
};

const LLM_CATALOG = {
  claude: { models: ["claude-sonnet-5"], providers: ["cli", "api"], defaultModel: "claude-sonnet-5", source: "built-in", checkedAt: null, cli: { found: true, version: "2.0.0", path: "/bin/claude" } },
  codex: { models: ["gpt-5.5"], providers: ["cli"], defaultModel: "gpt-5.5", source: "built-in", checkedAt: null, cli: { found: false, version: null, path: null } },
  google: { models: ["gemini-2.5-pro"], providers: ["api"], defaultModel: "gemini-2.5-pro", source: "built-in", checkedAt: null },
  local: { models: [], providers: ["api"], defaultModel: "", reachable: false },
};

/**
 * Serves the one config the Robot Wrangler page waits for (it shows its own
 * loading state until the config arrives); every other endpoint answers `{}`.
 */
function stubApi() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = String(url).includes("/api/llm/catalog") ? LLM_CATALOG
      : String(url).includes("/api/llm/config") ? LLM_CONFIG
      : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
}

let root: HTMLDivElement;

async function mountOverlay(view: ViewId, loading: boolean): Promise<void> {
  root = document.createElement("div");
  document.body.appendChild(root);
  const overlay = h(SettingsOverlay, { view, validViews: VALID, onNavigate: vi.fn(), onClose: vi.fn() },
    renderViewContent(view, loading, ctx));
  await act(async () => { render(overlay, root); });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

const content = () => root.querySelector(".settings-overlay-content")!;

beforeEach(() => {
  clearProjectMetadataCache();
  localStorage.clear();
  stubApi();
});

afterEach(() => {
  render(null, root);
  root.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("settings pages while the analysis data is loading", () => {
  const PAGES: Array<[ViewId, string]> = [
    ["robot-wrangler", ".llm-header-title"],
    ["project", ".project-header-title"],
    ["workflow", ".workflow-header-title"],
    ["commands", ".view-title"],
  ];
  const TITLES: Record<string, string> = {
    "robot-wrangler": "Robot Wrangler",
    project: "Project",
    workflow: "Workflow",
    commands: "Commands",
  };

  it.each(PAGES)("%s renders its own content", async (view, titleSelector) => {
    await mountOverlay(view, true);
    expect(content().querySelector(titleSelector)?.textContent).toBe(TITLES[view]);
    expect(content().textContent).not.toBe("Loading...");
  });
});

describe("analysis views while the analysis data is loading", () => {
  it("overview still shows the loading state", async () => {
    await mountOverlay("overview", true);
    const loading = content().querySelector(".loading");
    expect(loading?.textContent).toBe("Loading...");
    expect(loading?.getAttribute("role")).toBe("status");
  });

  it("overview hands over to the view once loading ends", async () => {
    await mountOverlay("overview", false);
    expect(content().textContent).not.toBe("Loading...");
  });
});
