// @vitest-environment jsdom
/**
 * Workflow: work settings, CLI timeouts and templates on one SettingsFrame.
 *
 * The page is dirty when either form has unsaved edits; Save writes each dirty
 * part to its own endpoint, and a part whose write fails stays dirty with its
 * error shown. Templates are immediate actions, disabled while the page is
 * dirty. Provider and model are Robot Wrangler's, so this page links there
 * instead of rendering them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { WorkflowView } from "../../../src/viewer/views/workflow.js";
import { TEMPLATES_BLOCKED_HINT } from "../../../src/viewer/views/hench-templates.js";
import { guardedLeave } from "../../../src/viewer/hooks/use-leave-guard.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import type { NavigateTo } from "../../../src/viewer/types.js";
// The server's field list is the contract the work-settings form renders.
// Importing it here is a test-only read of the other side of the boundary.
import { CONFIG_FIELD_META } from "../../../src/server/hench-config-fields.js";

type Json = Record<string, unknown>;

interface Field {
  path: string;
  label: string;
  description: string;
  type: string;
  enumValues?: string[];
  category: string;
  value: unknown;
  defaultValue: unknown;
  isDefault: boolean;
  impact: string;
}

function field(path: string, type: string, category: string, value: unknown, extra: Partial<Field> = {}): Field {
  return { path, label: path, description: `${path} description`, type, category, value, defaultValue: value, isDefault: true, impact: `${path} impact`, ...extra };
}

/** A small, hand-written field list — enough to exercise each control type. */
function smallFields(maxTurns = 50): Field[] {
  return [
    field("provider", "enum", "execution", "cli", { enumValues: ["cli", "api"] }),
    field("model", "string", "execution", "sonnet"),
    field("maxTurns", "number", "execution", maxTurns, { label: "Max Turns", defaultValue: 50, isDefault: maxTurns === 50 }),
    field("retry.maxRetries", "number", "retry", 3, { label: "Max Retries" }),
    field("guard.allowedCommands", "array", "guard", ["npm", "git"], {
      label: "Allowed Commands", defaultValue: ["npm", "npx", "node"], isDefault: false,
    }),
  ];
}

/** Every field the server serves, as GET /api/hench/config would return it. */
function allFields(): Field[] {
  return CONFIG_FIELD_META.map((m) => {
    const value = m.defaultValue ?? (m.type === "boolean" ? false : m.type === "array" ? [] : m.type === "number" ? 0 : m.enumValues?.[0] ?? "x");
    return { ...m, value, defaultValue: m.defaultValue, isDefault: true, impact: "" } as Field;
  });
}

const TIMEOUTS = { timeoutMs: null, timeouts: {}, defaultTimeoutMs: 1_800_000, noDefaultTimeoutCommands: ["start", "dev"] };

const TEMPLATES = {
  templates: [
    { id: "quick", name: "Quick", description: "Short runs", useCases: [], tags: [], config: { maxTurns: 10 }, builtIn: true },
  ],
};

interface Request { method: string; url: string; body: Json | null }

/**
 * Serves the three APIs the page reads. `failures` turns a PUT into a 500 with
 * that message; applying the "quick" template sets maxTurns to 10, so the next
 * config read returns it.
 */
function stubApi(opts: { fields?: () => Field[]; failures?: Record<string, string> } = {}) {
  const requests: Request[] = [];
  let maxTurns = 50;
  const fields = opts.fields ?? (() => smallFields(maxTurns));
  const respond = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

  const mock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    requests.push({ method, url, body: init?.body ? JSON.parse(init.body) as Json : null });
    const failure = method !== "GET" ? opts.failures?.[url] : undefined;
    if (failure) return respond({ error: failure }, 500);

    switch (`${method} ${url}`) {
      case "GET /api/hench/config":
        return respond({ config: { schema: "hench/v1", maxTurns }, fields: fields() });
      case "PUT /api/hench/config":
        return respond({ applied: [] });
      case "GET /api/cli/timeouts":
        return respond(TIMEOUTS);
      case "PUT /api/cli/timeouts":
        return respond({ ok: true });
      case "GET /api/hench/templates":
        return respond(TEMPLATES);
      case "POST /api/hench/templates/quick/apply":
        maxTurns = 10;
        return respond({ templateName: "Quick" });
      default:
        return respond({});
    }
  });
  vi.stubGlobal("fetch", mock);
  return { requests, writes: () => requests.filter((r) => r.method !== "GET") };
}

async function settle() {
  // Wait inside act so the state updates fetch resolutions trigger commit
  // synchronously rather than arming preact's after-paint fallback timer.
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

describe("WorkflowView", () => {
  let root: HTMLDivElement;
  let navigateTo: ReturnType<typeof vi.fn<NavigateTo>>;

  beforeEach(() => {
    clearProjectMetadataCache();
    root = document.createElement("div");
    document.body.appendChild(root);
    navigateTo = vi.fn<NavigateTo>();
  });

  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });

  async function mount() {
    act(() => { render(h(WorkflowView, { navigateTo }), root); });
    await settle();
  }

  // ── Queries ───────────────────────────────────────────────────────

  const section = (title: string) =>
    [...root.querySelectorAll<HTMLElement>(".workflow-section")]
      .find((s) => s.querySelector(".workflow-section-title")?.textContent === title)!;

  const renderedFieldPaths = () =>
    [...root.querySelectorAll(".hench-config-field-path")].map((n) => n.textContent);

  const henchField = (path: string) =>
    [...root.querySelectorAll<HTMLElement>(".hench-config-field")]
      .find((f) => f.querySelector(".hench-config-field-path")?.textContent === path)!;

  const henchInput = (path: string) => henchField(path).querySelector<HTMLInputElement>("input")!;
  const globalTimeoutInput = () =>
    root.querySelector<HTMLInputElement>('input[aria-label="Global CLI timeout in milliseconds"]')!;

  const indicator = () => root.querySelector(".settings-frame-indicator")!.textContent;
  const saveButton = () => root.querySelector<HTMLButtonElement>(".settings-frame-save")!;
  const applyButton = () => root.querySelector<HTMLButtonElement>(".hench-template-apply-btn")!;
  const saveAsTemplateButton = () => root.querySelector<HTMLButtonElement>(".hench-template-save-current-btn")!;

  async function type(input: HTMLInputElement, value: string) {
    await act(async () => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function clickSave() {
    await act(async () => { saveButton().click(); });
    await settle();
  }

  // ── Layout ────────────────────────────────────────────────────────

  it("shows a loading state before the data arrives", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => { /* never resolves */ })));
    act(() => { render(h(WorkflowView, { navigateTo }), root); });
    expect(root.textContent).toContain("Loading work settings");
    expect(root.textContent).toContain("Loading timeout configuration");
    expect(root.textContent).toContain("Loading templates");
  });

  it("puts work settings, CLI timeouts and templates inside exactly one settings frame", async () => {
    stubApi();
    await mount();

    expect(root.querySelectorAll(".settings-frame")).toHaveLength(1);
    const titles = [...root.querySelectorAll(".workflow-section-title")].map((t) => t.textContent);
    expect(titles).toEqual(["Work settings", "CLI timeouts", "Templates"]);
    expect(root.querySelector(".workflow-header-title")!.textContent).toBe("Workflow");
    // The frame owns Save: none of the sections' old save bars or toasts remain.
    expect(root.querySelector(".hench-config-changes-panel")).toBeNull();
    expect(root.querySelector(".ct-changes-panel")).toBeNull();
  });

  it("fetches each part from its own endpoint on mount", async () => {
    const { requests } = stubApi();
    await mount();
    const reads = requests.filter((r) => r.method === "GET").map((r) => r.url);
    expect(reads).toEqual(expect.arrayContaining(["/api/hench/config", "/api/cli/timeouts", "/api/hench/templates"]));
  });

  it("renders every field GET /api/hench/config serves except provider and model", async () => {
    stubApi({ fields: allFields });
    await mount();

    const expected = CONFIG_FIELD_META.map((f) => f.path).filter((p) => p !== "provider" && p !== "model");
    expect(renderedFieldPaths().sort()).toEqual([...expected].sort());
  });

  it("links to Robot Wrangler where provider and model would be", async () => {
    stubApi();
    await mount();

    expect(renderedFieldPaths()).not.toContain("provider");
    expect(renderedFieldPaths()).not.toContain("model");
    const link = root.querySelector(".workflow-wrangler-link")!;
    // At the head of the category those two fields belong to.
    expect(link.closest(".hench-config-category")!.querySelector(".hench-config-category-title")!.textContent)
      .toBe("Execution Strategy");

    await act(async () => { link.querySelector("button")!.click(); });
    expect(navigateTo).toHaveBeenCalledWith("robot-wrangler");
  });

  it("shows category headers, current values and the right control per field type", async () => {
    stubApi();
    await mount();

    const work = section("Work settings");
    expect(work.textContent).toContain("Execution Strategy");
    expect(work.textContent).toContain("Retry Policy");
    expect(work.textContent).toContain("Guard Rails");
    expect(henchInput("maxTurns").value).toBe("50");
    expect(work.querySelectorAll('input[type="number"]')).toHaveLength(2); // maxTurns, retry.maxRetries
    expect(work.querySelectorAll(".hench-config-select")).toHaveLength(0); // provider is not rendered
    expect(work.querySelectorAll(".hench-config-tag")).toHaveLength(2); // npm, git
    expect(work.textContent).toContain("maxTurns impact");
  });

  it("marks fields that differ from defaults and counts them", async () => {
    stubApi();
    await mount();

    expect(root.querySelectorAll(".hench-config-modified-badge")).toHaveLength(1); // allowedCommands
    expect(section("Work settings").textContent).toContain("1 field differs from defaults");
  });

  it("shows the load error and the init hint when the hench config is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/hench/config"
      ? { ok: false, status: 404, json: async () => ({ error: "Hench configuration not found" }) }
      : { ok: true, status: 200, json: async () => (url === "/api/cli/timeouts" ? TIMEOUTS : TEMPLATES) }));
    await mount();

    const work = section("Work settings");
    expect(work.textContent).toContain("Hench configuration not found");
    expect(work.textContent).toContain("hench init");
    // The other parts still load.
    expect(globalTimeoutInput()).toBeTruthy();
  });

  // ── Dirty state ───────────────────────────────────────────────────

  it("is clean on load, with Save disabled", async () => {
    stubApi();
    await mount();
    expect(indicator()).toBe("All changes saved");
    expect(saveButton().disabled).toBe(true);
  });

  it("is dirty when a work setting is edited, with an unsaved badge and impact preview", async () => {
    stubApi();
    await mount();

    await type(henchInput("maxTurns"), "10");

    expect(indicator()).toBe("Unsaved changes");
    expect(saveButton().disabled).toBe(false);
    const edited = henchField("maxTurns");
    expect(edited.querySelector(".hench-config-dirty-badge")!.textContent).toBe("unsaved");
    expect(edited.querySelector(".hench-config-preview")!.textContent).toContain("10 turns");
  });

  it("is dirty when a CLI timeout is edited", async () => {
    stubApi();
    await mount();

    await type(globalTimeoutInput(), "60000");

    expect(indicator()).toBe("Unsaved changes");
    expect(root.querySelector(".ct-badge-unsaved")).toBeTruthy();
  });

  it("is dirty while a timeout holds invalid input, so the edit cannot be lost silently", async () => {
    stubApi();
    await mount();

    await type(globalTimeoutInput(), "abc");

    expect(indicator()).toBe("Unsaved changes");
    expect(root.querySelector(".ct-field-error")).toBeTruthy();
  });

  it("shows a validation error for an invalid work setting", async () => {
    stubApi();
    await mount();

    await type(henchInput("maxTurns"), "");

    expect(henchField("maxTurns").querySelector(".hench-config-error")).toBeTruthy();
  });

  it("is clean again once each edit is reverted", async () => {
    stubApi();
    await mount();

    await type(henchInput("maxTurns"), "10");
    await act(async () => { henchField("maxTurns").querySelector<HTMLButtonElement>(".hench-config-reset-btn")!.click(); });

    expect(indicator()).toBe("All changes saved");
    expect(root.querySelectorAll(".hench-config-dirty-badge")).toHaveLength(0);
  });

  it("restores both parts when the leave prompt's Discard is chosen", async () => {
    stubApi();
    await mount();
    await type(henchInput("maxTurns"), "10");
    await type(globalTimeoutInput(), "60000");

    const leave = vi.fn();
    await act(async () => { guardedLeave(leave); });
    expect(leave).not.toHaveBeenCalled();
    await act(async () => { root.querySelector<HTMLButtonElement>(".leave-guard-discard-btn")!.click(); });

    expect(leave).toHaveBeenCalledTimes(1);
    expect(indicator()).toBe("All changes saved");
    expect(henchInput("maxTurns").value).toBe("50");
    expect(globalTimeoutInput().value).toBe("");
  });

  // ── Save ──────────────────────────────────────────────────────────

  it("writes work settings to PUT /api/hench/config with the coerced values", async () => {
    const { writes } = stubApi();
    await mount();

    await type(henchInput("maxTurns"), "10");
    await clickSave();

    expect(writes()).toEqual([
      { method: "PUT", url: "/api/hench/config", body: { changes: { maxTurns: 10 } } },
    ]);
    expect(indicator()).toBe("All changes saved");
  });

  it("writes CLI timeouts to PUT /api/cli/timeouts with the changed values", async () => {
    const { writes } = stubApi();
    await mount();

    await type(globalTimeoutInput(), "60000");
    const workInput = root.querySelector<HTMLInputElement>('input[aria-label="Timeout for work in milliseconds"]')!;
    await type(workInput, "0");
    await clickSave();

    expect(writes()).toEqual([
      { method: "PUT", url: "/api/cli/timeouts", body: { timeoutMs: 60000, timeouts: { work: 0 } } },
    ]);
    expect(indicator()).toBe("All changes saved");
  });

  it("writes each dirty part to its own endpoint in one Save", async () => {
    const { writes } = stubApi();
    await mount();

    await type(henchInput("maxTurns"), "10");
    await type(globalTimeoutInput(), "60000");
    await clickSave();

    const byUrl = Object.fromEntries(writes().map((w) => [w.url, w.body]));
    expect(byUrl).toEqual({
      "/api/hench/config": { changes: { maxTurns: 10 } },
      "/api/cli/timeouts": { timeoutMs: 60000 },
    });
  });

  it("keeps the failed part dirty with its error, and the saved part clean", async () => {
    stubApi({ failures: { "/api/cli/timeouts": "Could not write the project config" } });
    await mount();

    await type(henchInput("maxTurns"), "10");
    await type(globalTimeoutInput(), "60000");
    await clickSave();

    // Work settings saved: no unsaved badge, the form shows the saved value.
    expect(henchField("maxTurns").querySelector(".hench-config-dirty-badge")).toBeNull();
    // Timeouts did not: still edited, with the server's error in that section.
    const timeouts = section("CLI timeouts");
    expect(globalTimeoutInput().value).toBe("60000");
    expect(timeouts.querySelector(".ct-badge-unsaved")).toBeTruthy();
    expect(timeouts.querySelector(".ct-error-banner")!.textContent).toBe("Could not write the project config");
    expect(section("Work settings").querySelector(".hench-config-save-error")).toBeNull();
    // The page stays dirty, and the frame names the part that failed.
    expect(indicator()).toBe("Unsaved changes");
    expect(root.querySelector(".settings-frame-error")!.textContent).toContain("CLI timeouts");
  });

  it("does not send a work setting that fails validation", async () => {
    const { writes } = stubApi();
    await mount();

    await type(henchInput("maxTurns"), "-5");
    await clickSave();

    expect(writes()).toEqual([]);
    expect(section("Work settings").querySelector(".hench-config-save-error")!.textContent).toContain("non-negative");
    expect(indicator()).toBe("Unsaved changes");
  });

  // ── Templates ─────────────────────────────────────────────────────

  it("disables Apply and Save as template while the page is dirty, with a hint", async () => {
    stubApi();
    await mount();
    expect(applyButton().disabled).toBe(false);
    expect(saveAsTemplateButton().disabled).toBe(false);
    expect(root.textContent).not.toContain(TEMPLATES_BLOCKED_HINT);

    await type(globalTimeoutInput(), "60000");

    expect(applyButton().disabled).toBe(true);
    expect(saveAsTemplateButton().disabled).toBe(true);
    expect(section("Templates").textContent).toContain(TEMPLATES_BLOCKED_HINT);
  });

  it("reloads the work settings after Apply, so the form shows the applied values", async () => {
    const { requests } = stubApi();
    await mount();
    expect(henchInput("maxTurns").value).toBe("50");

    await act(async () => { applyButton().click(); });
    await settle();

    expect(requests.some((r) => r.method === "POST" && r.url === "/api/hench/templates/quick/apply")).toBe(true);
    expect(henchInput("maxTurns").value).toBe("10");
    // Applying is an immediate action, not an unsaved edit.
    expect(indicator()).toBe("All changes saved");
  });
});
