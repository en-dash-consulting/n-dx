// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { HenchConfigView } from "../../../src/viewer/views/hench-config.js";

/** Mock config response from GET /api/hench/config. */
function makeConfigResponse() {
  return {
    config: {
      schema: "hench/v1",
      provider: "cli",
      model: "sonnet",
      maxTurns: 50,
      maxTokens: 8192,
      tokenBudget: 0,
      loopPauseMs: 2000,
      maxFailedAttempts: 3,
      rexDir: ".rex",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      guard: {
        blockedPaths: [".hench/**", ".rex/**"],
        allowedCommands: ["npm", "git"],
        commandTimeout: 30000,
        maxFileSize: 1048576,
      },
      retry: { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 30000 },
    },
    fields: [
      {
        path: "provider",
        label: "Provider",
        description: "Claude provider",
        type: "enum",
        enumValues: ["cli", "api"],
        category: "execution",
        value: "cli",
        defaultValue: "cli",
        isDefault: true,
        impact: "Agent will use Claude Code CLI",
      },
      {
        path: "model",
        label: "Model",
        description: "Claude model to use",
        type: "string",
        category: "execution",
        value: "sonnet",
        defaultValue: "sonnet",
        isDefault: true,
        impact: 'Agent will use model "sonnet"',
      },
      {
        path: "maxTurns",
        label: "Max Turns",
        description: "Maximum conversation turns per run",
        type: "number",
        category: "execution",
        value: 50,
        defaultValue: 50,
        isDefault: true,
        impact: "Agent will stop after 50 turns (long runs)",
      },
      {
        path: "retry.maxRetries",
        label: "Max Retries",
        description: "Number of retry attempts",
        type: "number",
        category: "retry",
        value: 3,
        defaultValue: 3,
        isDefault: true,
        impact: "Transient errors retried up to 3 times",
      },
      {
        path: "guard.allowedCommands",
        label: "Allowed Commands",
        description: "Shell commands the agent can execute",
        type: "array",
        category: "guard",
        value: ["npm", "git"],
        defaultValue: ["npm", "npx", "node", "git", "tsc", "vitest"],
        isDefault: false,
        impact: "Agent can execute: npm, git",
      },
    ],
  };
}

/**
 * Render the component and wait for async data to load.
 *
 * The component has a two-phase lifecycle:
 * 1. Initial render shows "Loading..." (synchronous)
 * 2. useEffect fires fetch, which resolves and calls setState (async)
 *
 * We use act() to flush effects (phase 1), then await the fetch promise
 * to resolve, then act() again to flush the re-render (phase 2).
 */
async function renderAndWait(root: HTMLDivElement) {
  // Phase 1: render + flush effects (triggers fetch)
  await act(async () => {
    render(h(HenchConfigView, null), root);
  });

  // Let the fetch promise chain fully resolve (fetch → res.json → setState)
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => queueMicrotask(r));

  // Phase 2: flush the re-render triggered by setState
  await act(async () => {
    // Nothing to do here — act() will flush any pending renders/effects
  });
}

describe("HenchConfigView", () => {
  let root: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    if (root) render(null, root);
    if (root?.parentNode) root.parentNode.removeChild(root);
    vi.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    fetchMock.mockReturnValue(new Promise(() => { /* never resolves */ }));

    render(h(HenchConfigView, null), root);
    expect(root.textContent).toContain("Loading");
  });

  it("renders configuration fields after loading", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    expect(root.textContent).toContain("Workflow Configuration");
    expect(root.textContent).toContain("Provider");
    expect(root.textContent).toContain("Model");
    expect(root.textContent).toContain("Max Turns");
  });

  it("shows category headers", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    expect(root.textContent).toContain("Execution Strategy");
    expect(root.textContent).toContain("Retry Policy");
    expect(root.textContent).toContain("Guard Rails");
  });

  it("displays current values", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    expect(root.textContent).toContain("sonnet");
    expect(root.textContent).toContain("50");
    expect(root.textContent).toContain("cli");
  });

  it("shows impact descriptions", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    expect(root.textContent).toContain("Agent will use Claude Code CLI");
  });

  it("shows modified badge for non-default fields", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    const badges = root.querySelectorAll(".hench-config-modified-badge");
    expect(badges.length).toBe(1); // Only allowedCommands is non-default
  });

  it("shows error state when config not found", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Hench configuration not found" }),
    });

    await renderAndWait(root);

    expect(root.textContent).toContain("not found");
  });

  it("renders edit buttons for each field", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    const editButtons = root.querySelectorAll(".hench-config-edit-btn");
    expect(editButtons.length).toBe(5); // One per field in mock
  });

  it("shows edit form when Edit button clicked", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    const editBtn = root.querySelector(".hench-config-edit-btn") as HTMLButtonElement;
    expect(editBtn).toBeTruthy();

    await act(async () => {
      editBtn.click();
    });

    expect(root.querySelector(".hench-config-save-btn")).toBeTruthy();
    expect(root.querySelector(".hench-config-cancel-btn")).toBeTruthy();
  });

  it("fetches from /api/hench/config on mount", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    expect(fetchMock).toHaveBeenCalledWith("/api/hench/config");
  });

  it("shows modified count in header", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    expect(root.textContent).toContain("1 field differs from defaults");
  });
});
