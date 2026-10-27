// @vitest-environment jsdom
/**
 * The Analysis view reads the PRD layout and hands it to the add panel: on v2
 * the add captures a change into the Inbox, so neither the tab nor the panel
 * may call itself Smart Add.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { AnalysisView } from "../../../src/viewer/views/analysis.js";
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

async function renderExpanded(): Promise<HTMLDivElement> {
  const root = renderToDiv(h(AnalysisView, null));
  await settle();
  act(() => { root.querySelector<HTMLButtonElement>(".rex-analysis-more")!.click(); });
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
    root = await renderExpanded();
    expect(root.querySelector(".rex-analysis-tab.active")!.textContent).toBe("Add to Inbox");
    expect(root.querySelector(".smart-add-title")!.textContent).toBe("Add to Inbox");
    expect(root.textContent).not.toContain("Smart Add");
  });

  it("keeps Smart Add on v1", async () => {
    mockLayout("v1");
    root = await renderExpanded();
    expect(root.querySelector(".rex-analysis-tab.active")!.textContent).toBe("Smart Add");
    expect(root.querySelector(".smart-add-title")!.textContent).toBe("Smart Add");
  });
});
