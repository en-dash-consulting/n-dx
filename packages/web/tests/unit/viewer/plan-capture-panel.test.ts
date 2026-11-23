// @vitest-environment jsdom
/**
 * Plan's capture: the New change side panel, opened from "Add to the plan" in
 * the page's head (or its tab), with the whole Add Items form. Rendered
 * through the real registry under the draft provider main.ts mounts above its
 * router, so the panel, the Add Items page and the shared draft are wired the
 * way the dashboard wires them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LoadedData, ViewId } from "../../../src/viewer/types.js";
import { renderActiveView, type ViewRenderContext } from "../../../src/viewer/views/view-registry.js";
import { CaptureDraftProvider } from "../../../src/viewer/views/analysis.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { emptyJobTray } from "../../helpers/job-tray.js";

const CHANGE = { id: "01J9CHANGE0000000000000000", type: "change", title: "Redo the checkout header", needsPlacement: true };
const PREVIEW = { preview: true, proposals: [], confidence: 0, qualityIssues: [], changes: [CHANGE] };
const STATUS = {
  initialized: true,
  sv: { freshness: "fresh", analyzedAt: null, minutesAgo: 5, modulesComplete: 6, modulesTotal: 6 },
  rex: { exists: true, layout: "v2", percentComplete: 50, stats: { total: 2, completed: 1, inProgress: 0, pending: 1, deferred: 0, blocked: 0 }, hasInProgress: false, hasPending: true, nextTaskTitle: null },
  hench: { configured: true, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
};
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let fetchSpy: ReturnType<typeof vi.fn>;
let root: HTMLDivElement;

function ctx(): ViewRenderContext {
  return {
    data: { manifest: null, inventory: null, imports: null, zones: null, components: null, callGraph: null } as LoadedData,
    setDetail: () => {},
    setPrdDetailContent: () => {},
    selectedFile: null,
    setSelectedFile: () => {},
    selectedZone: null,
    selectedRunId: null,
    selectedTaskId: null,
    askSeed: null,
    navigateTo: () => {},
    isFeatureDisabled: () => false,
    askEnabled: false,
    jobs: emptyJobTray(),
    validViews: buildValidViews(null),
  };
}

async function tick() {
  await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
}

async function settle() {
  for (let i = 0; i < 8; i++) await tick();
}

async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await tick();
  }
  throw new Error("timed out waiting for the page");
}

/** Click inside act() and let the handler's fetch chain commit there too (see smart-add-input.test.ts). */
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await new Promise<void>((r) => setTimeout(r, 0));
  });
  await settle();
}

async function type(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const addButton = () => root.querySelector<HTMLButtonElement>(".stage-side-action")!;
const panel = () => root.querySelector<HTMLElement>('.stage-side-panel[data-panel="new-change"]');
const textarea = () => panel()!.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!;

/** Navigates the harness, as the dashboard's router would. */
let go: (view: ViewId) => void = () => {};

/** main.ts in miniature: the capture draft above a router that renders one view. */
function App() {
  const [view, setView] = useState<ViewId>("plan");
  go = setView;
  return h(CaptureDraftProvider, null, renderActiveView(view, { ...ctx(), navigateTo: (v: ViewId) => setView(v) }));
}

async function navigate(view: ViewId) {
  await act(async () => { go(view); });
  await settle();
}

async function mountPlan() {
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(h(App, null), root); });
  await settle();
  await until(() => !!root.querySelector(".stage-side-action"));
}

/** Open New change from the head, focused first as a keyboard user's press would leave it. */
async function openPanel() {
  addButton().focus();
  await click(addButton());
  await until(() => !!panel()?.querySelector(".smart-add-btn-attach"));
}

/** Pick a PNG through `container`'s hidden file input, as the "+" button's picker would. */
async function attachPng(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>(".smart-add-attach-input")!;
  Object.defineProperty(input, "files", { value: [new File([PNG_BYTES], "mock.png", { type: "image/png" })], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await until(() => !!container.querySelector(".smart-add-attachment"));
}

const uploads = () => fetchSpy.mock.calls.filter((c) => String(c[0]).endsWith("/attachments"));

beforeEach(() => {
  clearProjectMetadataCache();
  localStorage.clear();
  fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/status") return json(STATUS);
    if (url === "/api/rex/changes") return json({ layout: "v2", changes: [] });
    if (url === "/api/llm/config") return json({ vendor: "claude", imageInput: true });
    if (url === "/api/rex/smart-add-preview") return json(PREVIEW);
    if (url === "/api/rex/smart-add-accept") return json({ ok: true, changes: [CHANGE] });
    if (url.endsWith("/attachments")) return json({ ok: true, files: ["mock.png"] });
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(async () => {
  await settle();
  await act(async () => { render(null, root); });
  root.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Plan's New change side panel", () => {
  it("opens from Add to the plan with the whole Add Items form, and is no tile on the page", async () => {
    await mountPlan();
    expect(root.querySelector('.stage-tile[data-tile="capture"]')).toBeNull();
    expect(panel()).toBeNull();
    await openPanel();
    const p = panel()!;
    expect(p.getAttribute("role")).toBe("dialog");
    expect(p.querySelector(".stage-side-title")?.textContent).toBe("Add to the plan");
    expect(p.querySelector(".stage-side-blurb")?.textContent).toBe("Describe it, and n-dx suggests where it goes.");
    expect(p.querySelector(".smart-add-header .smart-add-title")?.textContent).toBe("Add to Inbox");
    expect(Array.from(p.querySelectorAll(".rex-analysis-tab")).map((t) => t.textContent)).toEqual(["Add to Inbox", "Batch Import", "Project Scan"]);
    expect(root.querySelector<HTMLElement>('.stage-side-tab[data-panel="new-change"]')?.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on Escape and returns focus to Add to the plan", async () => {
    await mountPlan();
    await openPanel();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(addButton());
  });

  it("captures into the Inbox from the panel, with its images", async () => {
    await mountPlan();
    await openPanel();
    await type(textarea(), "Redo the checkout header");
    await attachPng(panel()!);

    await click(panel()!.querySelector<HTMLButtonElement>(".smart-add-btn-generate")!);
    await until(() => !!panel()!.querySelector(".smart-add-btn-accept"));
    await click(panel()!.querySelector<HTMLButtonElement>(".smart-add-btn-accept")!);
    await until(() => !panel()!.querySelector(".smart-add-attachment"));

    const accept = fetchSpy.mock.calls.find((c) => c[0] === "/api/rex/smart-add-accept")!;
    expect(JSON.parse(accept[1].body)).toEqual({ text: "Redo the checkout header" });
    expect(uploads()).toHaveLength(1);
    expect(uploads()[0]![0]).toBe(`/api/rex/items/${CHANGE.id}/attachments`);
    expect(JSON.parse(uploads()[0]![1].body).images).toEqual([
      { name: "mock.png", mediaType: "image/png", data: Buffer.from(PNG_BYTES).toString("base64") },
    ]);
    expect(textarea().value).toBe("");
  });

  it("keeps the panel's text through Open ↗ to the Add Items page, and the page's text back on Plan", async () => {
    await mountPlan();
    await openPanel();
    await type(textarea(), "Redo the checkout header");
    await act(async () => { panel()!.querySelector<HTMLButtonElement>(".stage-side-open")!.click(); });
    await settle();
    expect(root.querySelector(".stage-side-panel")).toBeNull();
    expect(root.querySelector<HTMLTextAreaElement>(".rex-analysis-view .smart-add-textarea")!.value).toBe("Redo the checkout header");

    await type(root.querySelector<HTMLTextAreaElement>(".rex-analysis-view .smart-add-textarea")!, "Redo the checkout footer");
    await navigate("plan");
    await until(() => !!root.querySelector(".stage-side-action"));
    await openPanel();
    expect(textarea().value).toBe("Redo the checkout footer");
  });

  it("is shared from main.ts, above the router, not from the Plan page alone", () => {
    const main = readFileSync(resolve(__dirname, "../../../src/viewer/main.ts"), "utf-8");
    const registry = readFileSync(resolve(__dirname, "../../../src/viewer/views/view-registry.ts"), "utf-8");
    expect(main).toMatch(/return h\(CaptureDraftProvider, null,/);
    expect(registry).not.toContain("CaptureDraftProvider");
  });

  it("keeps an image attached when the panel closes, and shows it when reopened, uploading nothing", async () => {
    await mountPlan();
    await openPanel();
    await attachPng(panel()!);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(panel()).toBeNull();

    await openPanel();
    expect(panel()!.querySelector<HTMLImageElement>(".smart-add-attachment-thumb")?.getAttribute("alt")).toBe("mock.png");
    expect(uploads()).toHaveLength(0);
  });
});
