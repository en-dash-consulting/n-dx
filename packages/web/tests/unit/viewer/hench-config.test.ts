// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { HenchConfigView, formatDisplayValue, coerceFieldValue, validateField, getPreviewImpact } from "../../../src/viewer/views/hench-config.js";
import type { ConfigField } from "../../../src/viewer/views/hench-config.js";

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

// ── Unit tests for pure helpers ──────────────────────────────────────

describe("formatDisplayValue", () => {
  it("joins arrays with comma", () => {
    expect(formatDisplayValue(["a", "b"])).toBe("a, b");
  });

  it("handles null/undefined", () => {
    expect(formatDisplayValue(null)).toBe("");
    expect(formatDisplayValue(undefined)).toBe("");
  });

  it("stringifies other values", () => {
    expect(formatDisplayValue(42)).toBe("42");
    expect(formatDisplayValue("hello")).toBe("hello");
  });
});

describe("coerceFieldValue", () => {
  const numberField: ConfigField = { path: "maxTurns", label: "Max Turns", description: "", type: "number", category: "execution", value: 50, defaultValue: 50, isDefault: true, impact: "" };
  const enumField: ConfigField = { path: "provider", label: "Provider", description: "", type: "enum", enumValues: ["cli", "api"], category: "execution", value: "cli", defaultValue: "cli", isDefault: true, impact: "" };
  const boolField: ConfigField = { path: "enabled", label: "Enabled", description: "", type: "boolean", category: "general", value: true, defaultValue: true, isDefault: true, impact: "" };
  const arrayField: ConfigField = { path: "guard.blockedPaths", label: "Blocked Paths", description: "", type: "array", category: "guard", value: [], defaultValue: [], isDefault: true, impact: "" };
  const stringField: ConfigField = { path: "model", label: "Model", description: "", type: "string", category: "execution", value: "sonnet", defaultValue: "sonnet", isDefault: true, impact: "" };

  it("coerces valid numbers", () => {
    expect(coerceFieldValue(numberField, "100")).toBe(100);
    expect(coerceFieldValue(numberField, "0")).toBe(0);
  });

  it("throws for invalid numbers", () => {
    expect(() => coerceFieldValue(numberField, "abc")).toThrow("must be a valid number");
    expect(() => coerceFieldValue(numberField, "")).toThrow("must be a valid number");
  });

  it("throws for negative numbers", () => {
    expect(() => coerceFieldValue(numberField, "-5")).toThrow("must be non-negative");
  });

  it("coerces valid enums", () => {
    expect(coerceFieldValue(enumField, "api")).toBe("api");
  });

  it("throws for invalid enums", () => {
    expect(() => coerceFieldValue(enumField, "invalid")).toThrow("must be one of: cli, api");
  });

  it("coerces booleans", () => {
    expect(coerceFieldValue(boolField, "true")).toBe(true);
    expect(coerceFieldValue(boolField, "false")).toBe(false);
  });

  it("coerces arrays from comma-separated string", () => {
    expect(coerceFieldValue(arrayField, "a, b, c")).toEqual(["a", "b", "c"]);
    expect(coerceFieldValue(arrayField, "")).toEqual([]);
  });

  it("coerces strings", () => {
    expect(coerceFieldValue(stringField, "opus")).toBe("opus");
  });

  it("throws for empty strings", () => {
    expect(() => coerceFieldValue(stringField, "")).toThrow("must not be empty");
    expect(() => coerceFieldValue(stringField, "   ")).toThrow("must not be empty");
  });
});

describe("validateField", () => {
  const numberField: ConfigField = { path: "maxTurns", label: "Max Turns", description: "", type: "number", category: "execution", value: 50, defaultValue: 50, isDefault: true, impact: "" };

  it("returns null for valid values", () => {
    expect(validateField(numberField, "100")).toBeNull();
  });

  it("returns error message for invalid values", () => {
    const err = validateField(numberField, "abc");
    expect(err).toContain("must be a valid number");
  });
});

describe("getPreviewImpact", () => {
  it("generates impact for provider field", () => {
    const field: ConfigField = { path: "provider", label: "Provider", description: "", type: "enum", enumValues: ["cli", "api"], category: "execution", value: "cli", defaultValue: "cli", isDefault: true, impact: "" };
    expect(getPreviewImpact(field, "api")).toContain("Anthropic API");
    expect(getPreviewImpact(field, "cli")).toContain("Claude Code CLI");
  });

  it("generates impact for model field", () => {
    const field: ConfigField = { path: "model", label: "Model", description: "", type: "string", category: "execution", value: "sonnet", defaultValue: "sonnet", isDefault: true, impact: "" };
    expect(getPreviewImpact(field, "opus")).toContain("opus");
  });

  it("generates impact for maxTurns field", () => {
    const field: ConfigField = { path: "maxTurns", label: "Max Turns", description: "", type: "number", category: "execution", value: 50, defaultValue: 50, isDefault: true, impact: "" };
    expect(getPreviewImpact(field, "10")).toContain("10 turns");
    expect(getPreviewImpact(field, "10")).toContain("short");
  });

  it("returns empty string for invalid number", () => {
    const field: ConfigField = { path: "maxTurns", label: "Max Turns", description: "", type: "number", category: "execution", value: 50, defaultValue: 50, isDefault: true, impact: "" };
    expect(getPreviewImpact(field, "abc")).toBe("");
  });

  it("generates impact for array field", () => {
    const field: ConfigField = { path: "guard.allowedCommands", label: "Allowed Commands", description: "", type: "array", category: "guard", value: ["npm"], defaultValue: ["npm"], isDefault: true, impact: "" };
    expect(getPreviewImpact(field, "npm, git, tsc")).toContain("npm, git, tsc");
  });
});

// ── Component tests ──────────────────────────────────────────────────

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

  it("displays current values in form controls", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    // Check select dropdown for provider has correct value
    const select = root.querySelector(".hench-config-select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("cli");

    // Check number input for maxTurns
    const numberInputs = root.querySelectorAll('input[type="number"]');
    expect(numberInputs.length).toBeGreaterThan(0);

    // Check text input for model
    const textInputs = root.querySelectorAll('input[type="text"]');
    expect(textInputs.length).toBeGreaterThan(0);
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

  it("renders form controls for each field", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    // 1 select (provider enum), 2 number inputs (maxTurns, retry.maxRetries),
    // and text inputs / tag lists for the rest
    const selects = root.querySelectorAll(".hench-config-select");
    expect(selects.length).toBe(1); // provider

    const numberInputs = root.querySelectorAll('input[type="number"]');
    expect(numberInputs.length).toBe(2); // maxTurns, retry.maxRetries
  });

  it("shows unsaved badge and impact preview when value changed", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    // Find the model text input and change its value
    const modelInput = root.querySelector('input[type="text"]') as HTMLInputElement;
    expect(modelInput).toBeTruthy();

    await act(async () => {
      // Simulate input event
      const evt = new Event("input", { bubbles: true });
      Object.defineProperty(evt, "target", { value: { value: "opus" } });
      modelInput.value = "opus";
      modelInput.dispatchEvent(evt);
    });

    // Should show unsaved badge
    const dirtyBadges = root.querySelectorAll(".hench-config-dirty-badge");
    expect(dirtyBadges.length).toBe(1);
    expect(dirtyBadges[0].textContent).toBe("unsaved");
  });

  it("shows changes summary panel when changes are pending", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    // No changes panel initially
    expect(root.querySelector(".hench-config-changes-panel")).toBeNull();

    // Change a value
    const modelInput = root.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      const evt = new Event("input", { bubbles: true });
      Object.defineProperty(evt, "target", { value: { value: "opus" } });
      modelInput.value = "opus";
      modelInput.dispatchEvent(evt);
    });

    // Changes panel should appear
    const panel = root.querySelector(".hench-config-changes-panel");
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain("1 unsaved change");
    expect(panel!.textContent).toContain("Save All Changes");
    expect(panel!.textContent).toContain("Discard All");
  });

  it("shows tag list for array fields", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    const tagLists = root.querySelectorAll(".hench-config-tag-list");
    expect(tagLists.length).toBe(1); // allowedCommands

    const tags = root.querySelectorAll(".hench-config-tag");
    expect(tags.length).toBe(2); // npm, git
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

  it("shows validation error for invalid number input", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    // Find the maxTurns number input (first number input)
    const numberInput = root.querySelector('input[type="number"]') as HTMLInputElement;
    expect(numberInput).toBeTruthy();

    await act(async () => {
      const evt = new Event("input", { bubbles: true });
      Object.defineProperty(evt, "target", { value: { value: "" } });
      numberInput.value = "";
      numberInput.dispatchEvent(evt);
    });

    const errors = root.querySelectorAll(".hench-config-error");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("discard all clears pending changes", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeConfigResponse()),
    });

    await renderAndWait(root);

    // Make a change
    const modelInput = root.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      const evt = new Event("input", { bubbles: true });
      Object.defineProperty(evt, "target", { value: { value: "opus" } });
      modelInput.value = "opus";
      modelInput.dispatchEvent(evt);
    });

    // Verify changes panel is shown
    expect(root.querySelector(".hench-config-changes-panel")).toBeTruthy();

    // Click discard
    const discardBtn = root.querySelector(".hench-config-discard-btn") as HTMLButtonElement;
    await act(async () => {
      discardBtn.click();
    });

    // Changes panel should be gone
    expect(root.querySelector(".hench-config-changes-panel")).toBeNull();
    expect(root.querySelectorAll(".hench-config-dirty-badge").length).toBe(0);
  });
});
