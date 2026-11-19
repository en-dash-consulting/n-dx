// @vitest-environment jsdom
/**
 * Plan's capture: a tile of its own, not a bar across the top of the page,
 * whose More opens the tile's modal with the whole Add Items form. Rendered
 * through the real registry under the draft provider main.ts mounts above its
 * router, so the tile, its modal, the Add Items page and the shared draft are
 * wired the way the dashboard wires them.
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

const tile = () => root.querySelector<HTMLElement>('.stage-tile[data-tile="capture"]')!;
const more = () => tile().querySelector<HTMLButtonElement>(".rex-analysis-more")!;
const dialog = () => root.querySelector<HTMLElement>('.stage-tile-fullscreen [role="dialog"]');

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
  await until(() => !!root.querySelector('.stage-tile[data-tile="capture"] .smart-add-btn-attach'));
}

/** Pick a PNG through `container`'s hidden file input, as the "+" button's picker would. */
async function attachPng(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>(".smart-add-attach-input")!;
  Object.defineProperty(input, "files", { value: [new File([PNG_BYTES], "mock.png", { type: "image/png" })], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await until(() => !!container.querySelector(".smart-add-attachment"));
}

const uploads = () => fetchSpy.mock.calls.filter((c) => String(c[0]).endsWith("/attachments"));
const accepts = () => fetchSpy.mock.calls.filter((c) => c[0] === "/api/rex/smart-add-accept");

async function openMore() {
  await click(more());
  await until(() => !!dialog()?.querySelector(".smart-add-btn-attach"));
}

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

describe("Plan's capture tile", () => {
  it("renders the describe-a-change input in its own tile, with no bar across the top", async () => {
    await mountPlan();
    expect(root.querySelector(".stage-section")).toBeNull();
    expect(tile().querySelector(".stage-tile-title")?.textContent).toBe("Describe a change");
    const textarea = tile().querySelector<HTMLTextAreaElement>(".smart-add-panel-bar .smart-add-textarea")!;
    expect(textarea.placeholder).toBe("Describe a change for the Inbox…");
    // The tile is the row alone: tabs and history are the modal's.
    expect(tile().querySelector(".rex-analysis-tab")).toBeNull();
    expect(tile().querySelector(".rex-analysis-history")).toBeNull();
    expect(more().getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("More opens a modal with the full form instead of expanding the tile", async () => {
    await mountPlan();
    expect(dialog()).toBeNull();
    await openMore();
    const modal = dialog()!;
    expect(modal.getAttribute("aria-modal")).toBe("true");
    expect(modal.getAttribute("aria-label")).toBe("Describe a change");
    expect(modal.querySelector(".smart-add-header .smart-add-title")?.textContent).toBe("Add to Inbox");
    expect(modal.querySelector(".smart-add-panel-bar")).toBeNull();
    expect(Array.from(modal.querySelectorAll(".rex-analysis-tab")).map((t) => t.textContent)).toEqual(["Add to Inbox", "Batch Import", "Project Scan"]);
    // The tile stays a row underneath.
    expect(tile().querySelector(".smart-add-panel-bar")).not.toBeNull();
    expect(tile().querySelector(".rex-analysis-tab")).toBeNull();
  });

  it("closes on Escape and returns focus to More", async () => {
    await mountPlan();
    await openMore();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(more());
  });

  it("closes on its close button and returns focus to More", async () => {
    await mountPlan();
    await openMore();
    await act(async () => { dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close Describe a change"]')!.click(); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(more());
  });

  it("closes on a backdrop click, not a click inside it, and returns focus to More", async () => {
    await mountPlan();
    await openMore();
    await act(async () => { dialog()!.querySelector<HTMLElement>(".smart-add-header")!.click(); });
    expect(dialog()).not.toBeNull();
    await act(async () => { root.querySelector<HTMLElement>(".stage-tile-fullscreen")!.click(); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(more());
  });

  it("captures from the tile into the Inbox, previewing in the tile", async () => {
    await mountPlan();
    await type(tile().querySelector<HTMLTextAreaElement>(".smart-add-textarea")!, "Redo the checkout header");
    await click(tile().querySelector<HTMLButtonElement>(".smart-add-btn-generate")!);
    await until(() => !!tile().querySelector(".smart-add-btn-accept"));
    expect(tile().querySelector(".smart-add-preview-card")?.textContent).toContain("Redo the checkout header");
    await click(tile().querySelector<HTMLButtonElement>(".smart-add-btn-accept")!);
    await until(() => !tile().querySelector(".smart-add-btn-accept"));

    const accept = fetchSpy.mock.calls.find((c) => c[0] === "/api/rex/smart-add-accept")!;
    expect(JSON.parse(accept[1].body)).toEqual({ text: "Redo the checkout header" });
    expect(tile().querySelector<HTMLTextAreaElement>(".smart-add-textarea")!.value).toBe("");
  });

  it("carries the tile's text into the modal, which captures it into the Inbox with its images", async () => {
    await mountPlan();
    await type(tile().querySelector<HTMLTextAreaElement>(".smart-add-textarea")!, "Redo the checkout header");
    await openMore();
    const modal = dialog()!;
    expect(modal.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!.value).toBe("Redo the checkout header");

    await attachPng(modal);

    await click(modal.querySelector<HTMLButtonElement>(".smart-add-btn-generate")!);
    await until(() => !!modal.querySelector(".smart-add-btn-accept"));
    await click(modal.querySelector<HTMLButtonElement>(".smart-add-btn-accept")!);
    await until(() => !modal.querySelector(".smart-add-attachment"));

    const accept = fetchSpy.mock.calls.find((c) => c[0] === "/api/rex/smart-add-accept")!;
    expect(JSON.parse(accept[1].body)).toEqual({ text: "Redo the checkout header" });
    const attach = fetchSpy.mock.calls.find((c) => String(c[0]).endsWith("/attachments"))!;
    expect(attach[0]).toBe(`/api/rex/items/${CHANGE.id}/attachments`);
    expect(JSON.parse(attach[1].body).images).toEqual([
      { name: "mock.png", mediaType: "image/png", data: Buffer.from(PNG_BYTES).toString("base64") },
    ]);
    // One draft: the capture cleared the tile's row as well.
    expect(tile().querySelector<HTMLTextAreaElement>(".smart-add-textarea")!.value).toBe("");
  });

  it("keeps the modal's text through Open ↗ to the Add Items page, and the page's text back on Plan", async () => {
    await mountPlan();
    await openMore();
    await type(dialog()!.querySelector<HTMLTextAreaElement>(".smart-add-textarea")!, "Redo the checkout header");
    await act(async () => { dialog()!.querySelector<HTMLButtonElement>(".stage-tile-open-page")!.click(); });
    await settle();
    expect(root.querySelector(".stage-tile")).toBeNull();
    expect(root.querySelector<HTMLTextAreaElement>(".rex-analysis-view .smart-add-textarea")!.value).toBe("Redo the checkout header");

    await type(root.querySelector<HTMLTextAreaElement>(".rex-analysis-view .smart-add-textarea")!, "Redo the checkout footer");
    await navigate("plan");
    expect(tile().querySelector<HTMLTextAreaElement>(".smart-add-textarea")!.value).toBe("Redo the checkout footer");
  });

  it("is shared from main.ts, above the router, not from the Plan page alone", () => {
    const main = readFileSync(resolve(__dirname, "../../../src/viewer/main.ts"), "utf-8");
    const registry = readFileSync(resolve(__dirname, "../../../src/viewer/views/view-registry.ts"), "utf-8");
    expect(main).toMatch(/return h\(CaptureDraftProvider, null,/);
    expect(registry).not.toContain("CaptureDraftProvider");
  });

  it("drops the tile's preview once the modal adds the change, so the change is added once", async () => {
    await mountPlan();
    await type(tile().querySelector<HTMLTextAreaElement>(".smart-add-textarea")!, "Redo the checkout header");
    await click(tile().querySelector<HTMLButtonElement>(".smart-add-btn-generate")!);
    await until(() => !!tile().querySelector(".smart-add-btn-accept"));

    await openMore();
    const modal = dialog()!;
    await click(modal.querySelector<HTMLButtonElement>(".smart-add-btn-generate")!);
    await until(() => !!modal.querySelector(".smart-add-btn-accept"));
    await click(modal.querySelector<HTMLButtonElement>(".smart-add-btn-accept")!);
    await until(() => accepts().length > 0);
    await settle();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });

    expect(tile().querySelector(".smart-add-btn-accept")).toBeNull();
    expect(tile().querySelector(".smart-add-preview-card")).toBeNull();
    expect(accepts()).toHaveLength(1);

    // And the other way: a modal opened after a tile capture shows no stale preview.
    await type(tile().querySelector<HTMLTextAreaElement>(".smart-add-textarea")!, "Redo the checkout footer");
    await click(tile().querySelector<HTMLButtonElement>(".smart-add-btn-generate")!);
    await until(() => !!tile().querySelector(".smart-add-btn-accept"));
    await click(tile().querySelector<HTMLButtonElement>(".smart-add-btn-accept")!);
    await until(() => accepts().length > 1);
    await settle();
    await openMore();
    expect(dialog()!.querySelector(".smart-add-btn-accept")).toBeNull();
    expect(accepts()).toHaveLength(2);
  });

  it("keeps an image attached in the modal when it closes: the tile shows it, and so does the modal reopened", async () => {
    await mountPlan();
    await openMore();
    await attachPng(dialog()!);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(dialog()).toBeNull();
    expect(tile().querySelector<HTMLImageElement>(".smart-add-attachment-thumb")?.getAttribute("alt")).toBe("mock.png");

    await openMore();
    expect(dialog()!.querySelector<HTMLImageElement>(".smart-add-attachment-thumb")?.getAttribute("alt")).toBe("mock.png");
    expect(uploads()).toHaveLength(0);
  });

  it("carries an image attached in the tile into the modal, uploads it on the modal's Add, and clears both", async () => {
    await mountPlan();
    await type(tile().querySelector<HTMLTextAreaElement>(".smart-add-textarea")!, "Redo the checkout header");
    await attachPng(tile());
    await openMore();
    const modal = dialog()!;
    expect(modal.querySelector<HTMLImageElement>(".smart-add-attachment-thumb")?.getAttribute("alt")).toBe("mock.png");

    await click(modal.querySelector<HTMLButtonElement>(".smart-add-btn-generate")!);
    await until(() => !!modal.querySelector(".smart-add-btn-accept"));
    await click(modal.querySelector<HTMLButtonElement>(".smart-add-btn-accept")!);
    await until(() => uploads().length > 0);
    await settle();

    expect(uploads()).toHaveLength(1);
    expect(uploads()[0]![0]).toBe(`/api/rex/items/${CHANGE.id}/attachments`);
    expect(JSON.parse(uploads()[0]![1].body).images.map((i: { name: string }) => i.name)).toEqual(["mock.png"]);
    expect(modal.querySelector(".smart-add-attachment")).toBeNull();
    expect(tile().querySelector(".smart-add-attachment")).toBeNull();
  });
});
