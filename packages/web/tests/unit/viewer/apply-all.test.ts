// @vitest-environment jsdom
/**
 * Apply all: the bar counts the waiting changes, previews before writing,
 * sends only the changes that can apply with their preview hashes, reports
 * what was skipped, and links to the setting that makes it automatic.
 *
 * @see src/viewer/views/apply-all.ts
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ApplyAllBar, effectText } from "../../../src/viewer/views/apply-all.js";

const PREVIEW = {
  changes: [
    { id: "c1", title: "Add Apple Pay", summary: "Shoppers can pay with Apple Pay", ok: true, hash: "h1", applied: [
      { delta: "modified", summary: "s", node: { id: "a", title: "Pay", type: "capability" } },
      { delta: "added", summary: "s", node: { id: "b", title: "Wallets", type: "capability" } },
    ] },
    { id: "c2", title: "Retire coupons", ok: false, error: "Cannot apply change CH-2", problems: ["its base is stale"] },
  ],
};

let root: HTMLDivElement | undefined;
let posts: Array<{ url: string; body: unknown }>;
afterEach(() => { if (root) { render(null, root); root.remove(); root = undefined; } vi.unstubAllGlobals(); });

async function mount(props: Partial<Parameters<typeof ApplyAllBar>[0]> = {}, results: unknown[] = [{ id: "c1", title: "Add Apple Pay", ok: true, applied: [] }]) {
  posts = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    posts.push({ url, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const body = url.endsWith("/preview") ? PREVIEW : { results };
    return { ok: true, status: 200, json: async () => body };
  }));
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(h(ApplyAllBar, { waiting: 2, ...props }), root!); });
}

const click = async (text: string) => {
  const button = [...root!.querySelectorAll("button")].find((b) => b.textContent === text)!;
  expect(button, text).toBeTruthy();
  await act(async () => { button.click(); });
  await act(async () => {});
};

describe("effectText", () => {
  it("counts adds, edits and retires in plain words", () => {
    expect(effectText(PREVIEW.changes[0]!.applied as never)).toBe("adds 1, edits 1");
    expect(effectText([])).toBe("no product changes");
  });
});

describe("ApplyAllBar", () => {
  it("renders nothing when no change is waiting", async () => {
    await mount({ waiting: 0 });
    expect(root!.innerHTML).toBe("");
  });

  it("previews, then applies only the changes that can, with their hashes", async () => {
    const onApplied = vi.fn();
    await mount({ onApplied });
    expect(root!.textContent).toContain("2 changes are done and waiting to be applied to the product.");
    await click("Apply all…");
    expect(posts.map((p) => p.url)).toEqual(["/api/rex/changes/apply-all/preview"]);
    expect(root!.textContent).toContain("1 change will apply; 1 change can't yet.");
    const items = [...root!.querySelectorAll(".aa-list li")].map((li) =>
      [li.querySelector(".aa-name")!.textContent, li.querySelector(".aa-effect")!.textContent]);
    expect(items).toEqual([
      ["Shoppers can pay with Apple Pay", "adds 1, edits 1"],
      ["Retire coupons", "can't apply: its base is stale"],
    ]);
    await click("Apply 1");
    expect(posts[1]).toEqual({ url: "/api/rex/changes/apply-all", body: { hashes: { c1: "h1" } } });
    expect(root!.textContent).toContain("Applied 1 change.");
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it("names a change skipped because it was edited since the preview", async () => {
    await mount({}, [{ id: "c1", title: "Add Apple Pay", ok: false, error: "moved", moved: true }]);
    await click("Apply all…");
    await click("Apply 1");
    expect(root!.textContent).toContain("Applied 0 changes. 1 change was skipped.");
    expect(root!.textContent).toContain("edited since the preview: apply it again");
  });

  it("links to the Workflow settings that apply changes automatically", async () => {
    const navigateTo = vi.fn();
    await mount({ navigateTo });
    await click("Apply automatically…");
    expect(navigateTo).toHaveBeenCalledWith("workflow");
  });
});
