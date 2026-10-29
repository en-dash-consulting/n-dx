// @vitest-environment jsdom
/**
 * Workflow > Sidecar: the section appears only while web.sidecar is on, edits
 * stay local until Save, and Save sends them (or refuses an invalid value).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
// The toggle is read through a hook that resolves after a fetch; a page that
// only learns the flag after its first paint cannot be flushed deterministically
// under jsdom, so the flag is served synchronously here.
const toggles = vi.hoisted(() => ({ sidecar: false }));
vi.mock("../../../src/viewer/hooks/use-feature-toggle.js", () => ({
  useFeatureToggle: (key: string, fallback: boolean) => (key === "web.sidecar" ? toggles.sidecar : fallback),
}));

import { WorkflowView } from "../../../src/viewer/views/workflow.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import type { NavigateTo } from "../../../src/viewer/types.js";

interface Req { method: string; url: string; body: Record<string, unknown> | null }

const SETTINGS = {
  mode: "ask",
  contextCeiling: { worktree: 100_000, hub: 40_000 },
  idleMs: 7_200_000,
  githubReads: false,
  defaults: { contextCeiling: { worktree: 100_000, hub: 40_000 }, idleMs: 7_200_000 },
  configFile: ".n-dx.json",
};
const REX_SETTINGS = {
  applyOn: "complete",
  applyOnSet: false,
  placementAutoAccept: "agree",
  placementAutoAcceptSet: false,
  choices: { applyOn: ["complete", "review", "release"], placementAutoAccept: ["none", "agree", "confident"] },
  defaults: { applyOn: "complete", placementAutoAccept: "agree" },
  warnings: [],
  configFile: ".n-dx.json",
};
const RULE ={ tool: "run_command", key: JSON.stringify(["ndx", "status", "."]) };

function stubApi(opts: { sidecar: boolean; failAllowAdd?: string }) {
  toggles.sidecar = opts.sidecar;
  const requests: Req[] = [];
  const respond = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    requests.push({ method, url, body: init?.body ? JSON.parse(init.body) : null });
    switch (`${method} ${url}`) {
      case "GET /api/features": return respond({ toggles: [{ key: "web.sidecar", enabled: opts.sidecar }] });
      case "GET /api/hench/templates": return respond({ templates: [] });
      case "GET /api/rex/settings": return respond(REX_SETTINGS);
      case "GET /api/hench/config": return respond({ config: { schema: "hench/v1" }, fields: [] });
      case "GET /api/cli/timeouts": return respond({ timeoutMs: null, timeouts: {}, defaultTimeoutMs: 1, noDefaultTimeoutCommands: [] });
      case "GET /api/sidecar/settings": return respond(SETTINGS);
      case "GET /api/sidecar/allow-list": return respond({ rules: [RULE] });
      case "POST /api/sidecar/allow-list":
        return opts.failAllowAdd ? respond({ error: opts.failAllowAdd }, 409) : respond({ rule: RULE });
      case "PUT /api/sidecar/settings": return respond(SETTINGS);
      case "DELETE /api/sidecar/allow-list": return respond({ removed: true });
      default: return respond({});
    }
  }));
  return { writes: () => requests.filter((r) => r.method !== "GET"), requests };
}

describe("Workflow Sidecar section", () => {
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

  async function settle() {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
  async function mount() {
    await act(async () => { render(h(WorkflowView, { navigateTo: vi.fn<NavigateTo>() }), root); });
    // The toggle is read first; the section then mounts and loads its data, so
    // the page needs several turns of the event loop to settle.
    for (let i = 0; i < 20; i += 1) await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
  const sidecar = () =>
    [...root.querySelectorAll<HTMLElement>(".workflow-section")]
      .find((s) => s.querySelector(".workflow-section-title")?.textContent === "Sidecar");
  const input = (label: string) => root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  async function type(el: HTMLInputElement, value: string) {
    await act(async () => { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); };
  const button = (text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === text);
  async function save() {
    await click(root.querySelector(".settings-frame-save"));
    await settle();
  }

  it("is absent while web.sidecar is off, and loads nothing", async () => {
    const api = stubApi({ sidecar: false });
    await mount();
    expect(sidecar()).toBeUndefined();
    expect(api.requests.some((r) => r.url.startsWith("/api/sidecar"))).toBe(false);
  });

  it("shows field cards with defaults, Ask mode with Auto locked, and locked rows", async () => {
    stubApi({ sidecar: true });
    await mount();
    const section = sidecar()!;
    expect(section).toBeDefined();
    const fields = [...section.querySelectorAll<HTMLElement>(".ct-field")].map((f) => f.dataset.field);
    expect(fields).toEqual(["allowList", "mode", "contextCeiling.worktree", "contextCeiling.hub", "idle", "githubReads"]);
    expect(input("Worktree context ceiling in tokens").value).toBe("100000");
    expect(input("Hub context ceiling in tokens").value).toBe("40000");
    expect(input("Idle window in minutes").value).toBe("120");
    const mode = section.querySelector<HTMLSelectElement>('select[aria-label="Sidecar mode"]')!;
    expect(mode.value).toBe("ask");
    expect(mode.querySelector<HTMLOptionElement>('option[value="auto"]')!.disabled).toBe(true);
    const locked = [...section.querySelectorAll('.sidecar-allow-rule[data-state="locked"] code')].map((c) => c.textContent);
    // The work row names the project's CLI (useCliName; "n-dx" with no /api/project).
    expect(locked).toEqual(["n-dx work", "git reset", "git push"]);
    expect(section.querySelector(".sidecar-allow-rule code")!.textContent).toBe("ndx status .");
  });

  it("writes nothing until Save, then sends the edits", async () => {
    const api = stubApi({ sidecar: true });
    await mount();
    await type(input("Worktree context ceiling in tokens"), "150000");
    await type(input("Idle window in minutes"), "30");
    await click(input("GitHub reads"));
    await type(input("Command to allow"), "ndx rex status .");
    await click(button("Add"));
    await click(button("Remove"));
    expect(api.writes()).toEqual([]);

    await save();
    expect(api.writes()).toEqual([
      { method: "POST", url: "/api/sidecar/allow-list", body: { tool: "run_command", argv: ["ndx", "rex", "status", "."] } },
      { method: "DELETE", url: "/api/sidecar/allow-list", body: RULE },
      {
        method: "PUT", url: "/api/sidecar/settings",
        body: { contextCeiling: { worktree: 150_000 }, idleMs: 1_800_000, githubReads: true },
      },
    ]);
  });

  it("refuses an invalid value with a message and writes nothing", async () => {
    const api = stubApi({ sidecar: true });
    await mount();
    await type(input("Hub context ceiling in tokens"), "0");
    await save();
    expect(api.writes()).toEqual([]);
    expect(root.textContent).toMatch(/The hub context ceiling must be a whole number of tokens above 0/);
    expect(root.textContent).toMatch(/Fix the invalid Sidecar settings before saving/);
  });

  it("shows the server's refusal when a command can never be allow-listed", async () => {
    stubApi({ sidecar: true, failAllowAdd: "A run_command call like this can never be allow-listed" });
    await mount();
    await type(input("Command to allow"), "ndx work .");
    await click(button("Add"));
    await save();
    expect(root.textContent).toMatch(/Not allow-listed \(ndx work \.\): A run_command call like this can never be allow-listed/);
  });
});
