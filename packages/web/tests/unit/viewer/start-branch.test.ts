// @vitest-environment jsdom
/**
 * The Start a branch dialog: the name prefilled from the first selected change's
 * slug and kept once typed in, stacking offered only on a work-set branch, the
 * request it sends, and the not-switched message with the switch command.
 *
 * @see src/viewer/components/start-branch.ts
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";
import { StartBranchDialog } from "../../../src/viewer/components/start-branch.js";
import { BRANCH_SWITCHED_EVENT } from "../../../src/viewer/hooks/use-git-status.js";

const PAY = { id: "c-1", displayId: "CH-1", title: "Add Apple Pay", slug: "add-apple-pay" };
const BILL = { id: "c-2", title: "Rework billing", slug: "rework-billing" };

let root: HTMLDivElement | undefined;
let posts: unknown[];

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function mount(branch: string | null, reply: { status: number; body: unknown } = { status: 200, body: { switched: true, branch: "feat/x", assigned: [] } }, preselect?: string) {
  posts = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit = {}) => {
    if (init.method === "POST") {
      posts.push(JSON.parse(init.body as string));
      return { ok: reply.status < 300, status: reply.status, json: async () => reply.body };
    }
    return { ok: true, status: 200, json: async () => ({ branch, defaultBranch: "main", changes: [PAY, BILL] }) };
  }));
  const onClose = vi.fn();
  const onSwitched = vi.fn();
  root = renderToDiv(h(StartBranchDialog, { preselect, onClose, onSwitched }));
  await flush();
  return { onClose, onSwitched };
}

const nameInput = () => document.querySelector<HTMLInputElement>('input[name="branch-name"]')!;
const box = (id: string) => document.querySelector<HTMLInputElement>(`input[type="checkbox"][data-change-id="${id}"]`)!;
const startButton = () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Start branch")!;
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); await flush(); };

describe("Start a branch dialog", () => {
  it("preselects the change it was opened from and prefills feat/<slug>", async () => {
    await mount(null, undefined, "c-1");
    expect(box("c-1").checked).toBe(true);
    expect(box("c-2").checked).toBe(false);
    expect(nameInput().value).toBe("feat/add-apple-pay");
  });

  it("names the branch from the first selected change, and keeps a typed name", async () => {
    await mount(null);
    expect(nameInput().value).toBe("");
    expect(startButton().disabled).toBe(true);
    await click(box("c-2"));
    await click(box("c-1"));
    expect(nameInput().value).toBe("feat/rework-billing");
    await act(async () => {
      nameInput().value = "feat/mine";
      nameInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(box("c-2"));
    expect(nameInput().value).toBe("feat/mine");
  });

  it("offers stacking only on a work-set branch", async () => {
    await mount(null, undefined, "c-1");
    expect(document.querySelector('input[type="radio"]')).toBeNull();
    expect(document.body.textContent).toContain("Cut from the default branch (main)");
    cleanupRenderedDiv(root!);
    root = undefined;

    await mount("feat/first", undefined, "c-1");
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.map((r) => r.value)).toEqual(["default", "current"]);
    expect(document.body.textContent).toContain("Stacked on feat/first");
  });

  it("sends the selection, name and base, and closes after a switch", async () => {
    const seen = vi.fn();
    window.addEventListener(BRANCH_SWITCHED_EVENT, seen);
    const { onClose, onSwitched } = await mount("feat/first", undefined, "c-1");
    await click(document.querySelector<HTMLInputElement>('input[type="radio"][value="current"]')!);
    await click(box("c-2"));
    await click(startButton());
    expect(posts).toEqual([{ changeIds: ["c-1", "c-2"], name: "feat/add-apple-pay", base: "current" }]);
    expect(onSwitched).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(seen).toHaveBeenCalledOnce();
    window.removeEventListener(BRANCH_SWITCHED_EVENT, seen);
  });

  it("says the checkout was not switched, why, and how to switch", async () => {
    const { onClose, onSwitched } = await mount(null, {
      status: 200,
      body: { switched: false, branch: "feat/add-apple-pay", reason: "dirty", switchCommand: "git switch feat/add-apple-pay" },
    }, "c-1");
    await click(startButton());
    const text = document.querySelector(".start-branch-result")?.textContent ?? "";
    expect(text).toContain("The checkout was not switched: it has uncommitted changes.");
    expect(text).toContain("git switch feat/add-apple-pay");
    expect(text).toContain("After switching, Add the changes");
    expect(onSwitched).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a refusal inline", async () => {
    await mount(null, { status: 409, body: { error: "A branch named feat/add-apple-pay already exists.", code: "NAME_TAKEN" } }, "c-1");
    await click(startButton());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("A branch named feat/add-apple-pay already exists.");
  });
});
