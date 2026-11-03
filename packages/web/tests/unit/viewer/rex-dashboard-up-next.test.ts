// @vitest-environment jsdom
/**
 * The Up Next card's header on the Work page names what the next item is.
 *
 * `/api/rex/dashboard` sends the raw PRD node — `type` on a v2 tree, `level`
 * on a v1 one, a `displayId` only once a change is placed — so the card reads
 * the type through `itemTypeOf`. Reading a field the wire does not carry left
 * an empty badge between the status dot and the priority, which on an Inbox
 * change with no priority read as a missing title.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { RexDashboard } from "../../../src/viewer/views/rex-dashboard.js";

const STATS = { total: 1, completed: 0, inProgress: 0, pending: 1, deferred: 0, blocked: 0 };

function stub(nextTask: object, layout: "v1" | "v2"): void {
  const dash = {
    title: "Demo",
    layout,
    stats: STATS,
    percentComplete: 0,
    epics: [],
    nextTask,
    priorities: { critical: 0, high: 0, medium: 0, low: 0, unset: 1 },
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const ok = String(input) === "/api/rex/dashboard";
    return new Response(JSON.stringify(ok ? dash : {}), {
      status: ok ? 200 : 404,
      headers: { "Content-Type": "application/json" },
    });
  }));
}

let root: HTMLDivElement;

async function mount(): Promise<void> {
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(h(RexDashboard, { navigateTo: vi.fn() }), root); });
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

/** The header's badges, in order, as the reader sees them. */
function badges(): string[] {
  const row = root.querySelector(".rex-dash-next-badges");
  expect(row).not.toBeNull();
  return [...row!.children].map((el) => el.textContent ?? "");
}

afterEach(() => {
  if (root) {
    render(null, root);
    root.remove();
  }
  vi.unstubAllGlobals();
});

describe("Up Next card header", () => {
  it("an Inbox change shows its type and no empty slot", async () => {
    stub({ id: "c1", title: "Support gift cards", type: "change", status: "pending", needsPlacement: true }, "v2");
    await mount();
    const shown = badges();
    expect(shown.every((text) => text.trim() !== "")).toBe(true);
    expect(shown).toContain("Change");
  });

  it("a placed change shows its display id beside its type", async () => {
    stub({ id: "c2", title: "Add Apple Pay", type: "change", status: "pending", displayId: "CH-1", priority: "high" }, "v2");
    await mount();
    const shown = badges();
    expect(shown.every((text) => text.trim() !== "")).toBe(true);
    expect(shown).toEqual(expect.arrayContaining(["CH-1", "Change", "high"]));
  });

  it("a v1 task shows its level", async () => {
    stub({ id: "t1", title: "Split the god file", level: "task", status: "pending", priority: "medium" }, "v1");
    await mount();
    const shown = badges();
    expect(shown.every((text) => text.trim() !== "")).toBe(true);
    expect(shown).toEqual(expect.arrayContaining(["Task", "medium"]));
  });
});
