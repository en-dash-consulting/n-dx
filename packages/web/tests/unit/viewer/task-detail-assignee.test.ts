// @vitest-environment jsdom
/**
 * The change detail panel's assignee picker: it suggests the known people,
 * writes the existing `assignee` field with its own PATCH, then asks the panel
 * to refresh. A refused write shows the server's reason and keeps the old value.
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
    { id: "Ann Lee <ann@shop.io>", name: "Ann Lee", email: "ann@shop.io", sources: ["me", "git"] },
    { id: "Bo Chen <bo@shop.io>", name: "Bo Chen", email: "bo@shop.io", sources: ["steward"] },
  ],
};

const change = (extra: Partial<PRDItemData> = {}): PRDItemData =>
  ({ id: "c1", title: "Gift cards", status: "pending", type: "change", ...extra });

let root: HTMLDivElement;
let patches: Array<{ url: string; body: unknown }>;
/** What the next PATCH answers. */
let patchAnswer: { status: number; body: unknown };

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

const inSection = <T extends Element>(sel: string) => root.querySelector<T>(`.task-assignee-section ${sel}`);

async function mountDetail(item: PRDItemData, props: Record<string, unknown> = {}): Promise<void> {
  await act(async () => { render(h(TaskDetail, { item, allItems: [item], onUpdate: vi.fn(), ...props }), root); });
  await settle();
}

async function typeAndSave(value: string): Promise<void> {
  const input = inSection<HTMLInputElement>(".assignee-input")!;
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { inSection<HTMLButtonElement>(".assignee-save")!.click(); });
  await settle();
}

beforeEach(() => {
  _resetPeopleForTests();
  patches = [];
  patchAnswer = { status: 200, body: { ok: true } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      patches.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(patchAnswer.body), { status: patchAnswer.status });
    }
    return url === "/api/rex/people"
      ? new Response(JSON.stringify(PEOPLE), { status: 200 })
      : new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }));
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  vi.unstubAllGlobals();
});

describe("TaskDetail assignee", () => {
  it("assigns a known person from their email, saving their full id, then refreshes the panel", async () => {
    const onPrdChanged = vi.fn();
    await mountDetail(change(), { onPrdChanged });

    const button = inSection<HTMLButtonElement>(".assignee-button")!;
    expect(button.textContent).toBe("Assign");
    await act(async () => { button.click(); });
    const suggested = [...root.querySelectorAll<HTMLOptionElement>(".task-assignee-section datalist option")].map((o) => o.value);
    expect(suggested).toEqual(["Ann Lee <ann@shop.io>", "Bo Chen <bo@shop.io>"]);

    // Typing a known person's email saves their full id, the form `ndx work --mine` matches.
    await typeAndSave("bo@shop.io");
    expect(patches).toEqual([{ url: "/api/rex/items/c1", body: { assignee: "Bo Chen <bo@shop.io>" } }]);
    expect(onPrdChanged).toHaveBeenCalled();
    expect(inSection(".assignee-button")?.textContent).toBe("Bo Chen");
  });

  it("clears an assignee with an empty value", async () => {
    await mountDetail(change({ assignee: "Bo Chen <bo@shop.io>" }));
    expect(inSection(".assignee-button")?.textContent).toBe("Bo Chen");

    await act(async () => { inSection<HTMLButtonElement>(".assignee-button")!.click(); });
    await act(async () => { inSection<HTMLButtonElement>(".assignee-clear")!.click(); });
    await settle();
    expect(patches).toEqual([{ url: "/api/rex/items/c1", body: { assignee: "" } }]);
  });

  it("shows the server's reason and keeps the previous assignee when the save is refused", async () => {
    const onPrdChanged = vi.fn();
    patchAnswer = { status: 409, body: { error: "Could not acquire PRD lock (held by PID 4242)" } };
    await mountDetail(change({ assignee: "Bo Chen <bo@shop.io>" }), { onPrdChanged });

    await act(async () => { inSection<HTMLButtonElement>(".assignee-button")!.click(); });
    await typeAndSave("ann@shop.io");

    expect(patches).toHaveLength(1);
    expect(inSection('[role="alert"]')?.textContent).toBe("Could not acquire PRD lock (held by PID 4242)");
    expect(onPrdChanged).not.toHaveBeenCalled();
    // Still editing, with nothing claimed as saved; cancelling shows the old value.
    await act(async () => { inSection<HTMLButtonElement>(".assignee-cancel")!.click(); });
    expect(inSection(".assignee-button")?.textContent).toBe("Bo Chen");
  });

  it("shows the assignee read-only when the panel cannot write", async () => {
    await mountDetail(change({ assignee: "Bo Chen <bo@shop.io>" }), { onUpdate: undefined });
    expect(root.querySelector(".task-assignee-section")?.textContent).toContain("Bo Chen <bo@shop.io>");
    expect(inSection(".assignee-button")).toBeNull();
  });
});
