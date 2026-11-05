// @vitest-environment jsdom
/**
 * Apply… in a change's detail panel: shown for a change awaiting apply only,
 * previews before it writes, applies on confirm, and shows rex's refusal.
 *
 * @see src/viewer/components/prd-tree/change-apply.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ChangeApplySection, effectLine } from "../../../src/viewer/components/prd-tree/change-apply.js";
import type { ChangeApply, ChangeRow, ChangeStage } from "../../../src/viewer/views/product-model.js";

const ID = "c1";

function row(stage: ChangeStage): ChangeRow {
  return { id: ID, title: "Add Apple Pay", stage, amends: [], touches: [], taskCount: 1, completedTaskCount: 1 };
}

const PREVIEW: ChangeApply = {
  layout: "v2",
  change: ID,
  appliedAt: "2026-11-05T00:00:00.000Z",
  applied: [
    { delta: "modified", summary: "Wallets count as cards", node: { id: "cap-card", displayId: "A1.1", title: "Pay by card", type: "capability" } },
    { delta: "added", summary: "Wallets", node: { id: "cap-wallet", title: "Wallets", type: "capability" }, under: { id: "area-pay", displayId: "A1", title: "Checkout" } },
  ],
};

let root: HTMLDivElement;
let posts: string[];
let answers: Record<string, { status: number; body: unknown }>;

function serve(stage: ChangeStage): void {
  posts = [];
  answers = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(url);
      const a = answers[url] ?? { status: 200, body: PREVIEW };
      return new Response(JSON.stringify(a.body), { status: a.status, headers: { "Content-Type": "application/json" } });
    }
    const body = url === "/api/rex/changes" ? { layout: "v2", changes: [row(stage)] } : undefined;
    return new Response(JSON.stringify(body ?? { error: "not found" }), { status: body ? 200 : 404, headers: { "Content-Type": "application/json" } });
  }));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
}

async function mount(onWritten = vi.fn()): Promise<typeof onWritten> {
  await act(async () => { render(h(ChangeApplySection, { changeId: ID, onWritten }), root); });
  await settle();
  return onWritten;
}

const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label) ?? null;

async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error("element missing");
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}

const PREVIEW_URL = `/api/rex/changes/${ID}/apply/preview`;
const APPLY_URL = `/api/rex/changes/${ID}/apply`;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  vi.unstubAllGlobals();
});

describe("ChangeApplySection", () => {
  it("shows Apply… for a change awaiting apply", async () => {
    serve("awaiting-apply");
    await mount();
    expect(button("Apply…")).not.toBeNull();
  });

  it.each<ChangeStage>(["proposed", "ready", "in-progress", "applied", "shipped"])("shows nothing for a %s change", async (stage) => {
    serve(stage);
    await mount();
    expect(root.textContent).toBe("");
  });

  it("Apply… previews each amendment's effect and writes nothing until Apply", async () => {
    serve("awaiting-apply");
    const onWritten = await mount();
    await click(button("Apply…"));
    expect(posts).toEqual([PREVIEW_URL]);
    expect([...root.querySelectorAll(".ca-effect")].map((li) => li.textContent)).toEqual([
      "Edits capability A1.1 Pay by card: Wallets count as cards",
      "Adds capability cap-wall Wallets under A1 Checkout: Wallets",
    ]);
    expect(onWritten).not.toHaveBeenCalled();

    await click(button("Apply"));
    expect(posts).toEqual([PREVIEW_URL, APPLY_URL]);
    expect(onWritten).toHaveBeenCalledTimes(1);
    expect(root.querySelector("[data-change-apply='applied']")?.textContent).toBe("Applied. 2 amendments on the product map.");
  });

  it("Cancel closes the preview without writing", async () => {
    serve("awaiting-apply");
    await mount();
    await click(button("Apply…"));
    await click(button("Cancel"));
    expect(posts).toEqual([PREVIEW_URL]);
    expect(button("Apply…")).not.toBeNull();
  });

  it("a refused preview shows rex's message and offers no Apply", async () => {
    serve("awaiting-apply");
    answers[PREVIEW_URL] = { status: 422, body: { error: "Cannot apply change CH-1: amendment 1 (modified A1.1): its target's spec moved", problems: ["x"] } };
    const onWritten = await mount();
    await click(button("Apply…"));
    expect(root.querySelector("[role='alert']")?.textContent).toBe("Cannot apply change CH-1: amendment 1 (modified A1.1): its target's spec moved");
    expect(button("Apply")).toBeNull();
    expect(posts).toEqual([PREVIEW_URL]);
    expect(onWritten).not.toHaveBeenCalled();
  });

  it("a refused apply shows rex's message", async () => {
    serve("awaiting-apply");
    answers[APPLY_URL] = { status: 422, body: { error: "Cannot apply change CH-1: already applied at 2026-11-05T00:00:00.000Z", problems: ["x"] } };
    const onWritten = await mount();
    await click(button("Apply…"));
    await click(button("Apply"));
    expect(root.querySelector("[role='alert']")?.textContent).toContain("already applied");
    expect(onWritten).not.toHaveBeenCalled();
  });
});

describe("effectLine", () => {
  it("names a retired node", () => {
    expect(effectLine({ delta: "removed", summary: "Gone", node: { id: "con-1", displayId: "K2", title: "Old rule", type: "constraint" } })).toBe("Retires constraint K2 Old rule: Gone");
  });
});
