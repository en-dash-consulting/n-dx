// @vitest-environment jsdom
/**
 * The change detail panel's assignee picker: it suggests the known people and
 * writes the existing `assignee` field through the panel's own update.
 *
 * @see src/viewer/components/prd-tree/task-detail.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import { _resetPeopleForTests } from "../../../src/viewer/components/assignee.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

vi.mock("../../../src/viewer/hooks/use-gateway.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createWSPipeline: vi.fn(() => ({ push: vi.fn(), dispose: vi.fn() })),
}));

const PEOPLE = {
  me: "Ann Lee <ann@shop.io>",
  people: [
    { id: "Ann Lee <ann@shop.io>", name: "Ann Lee", email: "ann@shop.io", sources: ["git"] },
    { id: "Bo Chen <bo@shop.io>", name: "Bo Chen", email: "bo@shop.io", sources: ["steward"] },
  ],
};

const change = (extra: Partial<PRDItemData> = {}): PRDItemData =>
  ({ id: "c1", title: "Gift cards", status: "pending", type: "change", ...extra });

let root: HTMLDivElement;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

async function typeAndSave(value: string): Promise<void> {
  const input = root.querySelector<HTMLInputElement>(".task-assignee-section .assignee-input")!;
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { root.querySelector<HTMLButtonElement>(".task-assignee-section .assignee-save")!.click(); });
  await settle();
}

beforeEach(() => {
  _resetPeopleForTests();
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    url === "/api/rex/people"
      ? new Response(JSON.stringify(PEOPLE), { status: 200 })
      : new Response(JSON.stringify({ error: "not found" }), { status: 404 })));
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  vi.unstubAllGlobals();
});

describe("TaskDetail assignee", () => {
  it("assigns a known person by picking their id from the suggestions", async () => {
    const item = change();
    const onUpdate = vi.fn();
    await act(async () => { render(h(TaskDetail, { item, allItems: [item], onUpdate }), root); });
    await settle();

    const button = root.querySelector<HTMLButtonElement>(".task-assignee-section .assignee-button")!;
    expect(button.textContent).toBe("Assign");
    await act(async () => { button.click(); });
    const suggested = [...root.querySelectorAll<HTMLOptionElement>(".task-assignee-section datalist option")].map((o) => o.value);
    expect(suggested).toEqual(["Ann Lee <ann@shop.io>", "Bo Chen <bo@shop.io>"]);

    // Typing a known person's email saves their full id, the form `ndx work --mine` matches.
    await typeAndSave("bo@shop.io");
    expect(onUpdate).toHaveBeenCalledWith("c1", { assignee: "Bo Chen <bo@shop.io>" });
  });

  it("clears an assignee with an empty value", async () => {
    const item = change({ assignee: "Bo Chen <bo@shop.io>" });
    const onUpdate = vi.fn();
    await act(async () => { render(h(TaskDetail, { item, allItems: [item], onUpdate }), root); });
    await settle();
    expect(root.querySelector(".task-assignee-section .assignee-button")?.textContent).toBe("Bo Chen");

    await act(async () => { root.querySelector<HTMLButtonElement>(".task-assignee-section .assignee-button")!.click(); });
    await act(async () => { root.querySelector<HTMLButtonElement>(".task-assignee-section .assignee-clear")!.click(); });
    await settle();
    expect(onUpdate).toHaveBeenCalledWith("c1", { assignee: "" });
  });

  it("shows the assignee read-only when the panel cannot write", async () => {
    const item = change({ assignee: "Bo Chen <bo@shop.io>" });
    await act(async () => { render(h(TaskDetail, { item, allItems: [item] }), root); });
    await settle();
    expect(root.querySelector(".task-assignee-section")?.textContent).toContain("Bo Chen <bo@shop.io>");
    expect(root.querySelector(".task-assignee-section .assignee-button")).toBeNull();
  });
});
