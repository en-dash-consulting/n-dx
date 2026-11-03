// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { ReorganizePanel } from "../../../src/viewer/components/prd-tree/reorganize-panel.js";

const REFUSAL =
  'Reorganize apply rewrites the whole PRD tree and refuses to run on branch "feature/x"';

const PROPOSALS = {
  structural: {
    proposals: [
      { id: 1, type: "merge", description: "Merge duplicates", risk: "low", confidence: 0.9, items: ["a", "b"] },
    ],
  },
  llm: [],
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function waitFor<T>(find: () => T | null | undefined): Promise<T> {
  for (let i = 0; i < 50; i++) {
    const found = find();
    if (found) return found;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("timed out waiting for element");
}

describe("ReorganizePanel apply refusal", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  function stubFetch(applyResponse: () => Response) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url === "/api/rex/reorganize/apply" ? applyResponse() : json(200, PROPOSALS)));
  }

  async function errorAfterClicking(selector: string): Promise<string | null> {
    render(h(ReorganizePanel, { open: true, onClose: () => {} }), root);
    await waitFor(() => root.querySelector(".reorg-card"));
    if (selector === ".reorg-btn-primary") {
      root.querySelector<HTMLInputElement>(".reorg-checkbox")!.click();
      await waitFor(() => root.querySelector(".reorg-card-selected"));
    }
    root.querySelector<HTMLButtonElement>(selector)!.click();
    return (await waitFor(() => root.querySelector(".reorg-error"))).textContent;
  }

  it("shows the branch-guard refusal for Apply selected", async () => {
    stubFetch(() => json(409, { error: REFUSAL }));
    expect(await errorAfterClicking(".reorg-btn-primary")).toContain('branch "feature/x"');
  });

  it("shows the branch-guard refusal for Apply all low-risk", async () => {
    stubFetch(() => json(409, { error: REFUSAL }));
    expect(await errorAfterClicking(".reorg-btn-secondary")).toContain('branch "feature/x"');
  });

  it("falls back to the status when the body carries no error", async () => {
    stubFetch(() => new Response("not json", { status: 500 }));
    expect(await errorAfterClicking(".reorg-btn-secondary")).toBe("Apply failed (500)");
  });
});
