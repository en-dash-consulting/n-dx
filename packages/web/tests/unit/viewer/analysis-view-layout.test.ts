// @vitest-environment jsdom
/**
 * The Analysis view reads the PRD layout and hands it to the add panel: on v2
 * the add captures a change into the Inbox, so neither the tab nor the panel
 * may call itself Smart Add. With `onMore` it is Plan's capture row instead.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { AnalysisView, CaptureDraftProvider } from "../../../src/viewer/views/analysis.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";

function mockLayout(layout: "v1" | "v2") {
  globalThis.fetch = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (url === "/api/rex/changes" ? { layout } : url.startsWith("/api/rex/log") ? { entries: [] } : { items: [] }),
  })) as unknown as typeof fetch;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => setTimeout(r, 0));
  });
}

async function renderFull(): Promise<HTMLDivElement> {
  const root = renderToDiv(h(AnalysisView, null));
  await settle();
  return root;
}

describe("AnalysisView add panel wording", () => {
  const realFetch = globalThis.fetch;
  let root: HTMLDivElement | undefined;
  afterEach(() => {
    if (root) cleanupRenderedDiv(root);
    root = undefined;
    globalThis.fetch = realFetch;
  });

  it("labels the tab and panel as an Inbox capture on v2", async () => {
    mockLayout("v2");
    root = await renderFull();
    expect(root.querySelector(".rex-analysis-tab.active")!.textContent).toBe("Add to Inbox");
    expect(root.querySelector(".smart-add-title")!.textContent).toBe("Add to Inbox");
    expect(root.textContent).not.toContain("Smart Add");
  });

  it("keeps Smart Add on v1", async () => {
    mockLayout("v1");
    root = await renderFull();
    expect(root.querySelector(".rex-analysis-tab.active")!.textContent).toBe("Smart Add");
    expect(root.querySelector(".smart-add-title")!.textContent).toBe("Smart Add");
  });

  it("is the whole form on its own page: tabs and history, no More", async () => {
    mockLayout("v2");
    root = await renderFull();
    expect(root.querySelector(".smart-add-panel-bar")).toBeNull();
    expect(root.querySelector(".rex-analysis-history")).not.toBeNull();
    expect(root.querySelector(".rex-analysis-more")).toBeNull();
  });
});

describe("AnalysisView as Plan's capture row", () => {
  const realFetch = globalThis.fetch;
  let root: HTMLDivElement | undefined;
  afterEach(() => {
    if (root) cleanupRenderedDiv(root);
    root = undefined;
    globalThis.fetch = realFetch;
  });

  it("is one input row whose More calls onMore with focus on itself, and reads no history", async () => {
    mockLayout("v2");
    const onMore = vi.fn(() => document.activeElement);
    root = renderToDiv(h(AnalysisView, { onMore }));
    await settle();
    expect(root.querySelector(".smart-add-panel-bar")).not.toBeNull();
    expect(root.querySelector(".rex-analysis-tab")).toBeNull();
    expect(root.querySelector(".rex-analysis-history")).toBeNull();
    expect(vi.mocked(globalThis.fetch).mock.calls.some((c) => String(c[0]).startsWith("/api/rex/log"))).toBe(false);

    const more = root.querySelector<HTMLButtonElement>(".rex-analysis-more")!;
    expect(more.textContent).toBe("More…");
    act(() => { more.click(); });
    expect(onMore).toHaveBeenCalledOnce();
    expect(onMore.mock.results[0]!.value).toBe(more);
  });

  it("shares one draft with the full form under a CaptureDraftProvider", async () => {
    mockLayout("v2");
    root = renderToDiv(h(CaptureDraftProvider, null,
      h("div", { class: "row" }, h(AnalysisView, { onMore: () => {} })),
      h("div", { class: "full" }, h(AnalysisView, null)),
    ));
    await settle();
    const row = root.querySelector<HTMLTextAreaElement>(".row .smart-add-textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(row, "Add a CSV export to reports");
      row.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(root.querySelector<HTMLTextAreaElement>(".full .smart-add-textarea")!.value).toBe("Add a CSV export to reports");
  });
});
