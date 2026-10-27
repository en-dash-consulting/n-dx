// @vitest-environment jsdom
/**
 * A stage section's header count (`StageSection.badge`) and its
 * open-while-non-empty default (`openWhenNonEmpty`).
 *
 * The count is read from `/api/status` through `useProjectStatus`; the
 * WebSocket pipeline is captured so a test can deliver `rex:prd-changed`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import type { VNode } from "preact";
import { act } from "preact/test-utils";
import { BadgedSection } from "../../../src/viewer/views/stage-pages.js";
import type { StageSection } from "../../../src/viewer/views/stages.js";

const flushes: Array<(batch: { types: Set<string> }) => void> = [];
vi.mock("../../../src/viewer/hooks/use-gateway.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createWSPipeline: vi.fn((opts: { onFlush: (batch: { types: Set<string> }) => void }) => {
    flushes.push(opts.onFlush);
    return { push: vi.fn(), dispose: vi.fn() };
  }),
}));

function status(inbox?: { open: number; appliedUnplaced: number }) {
  return {
    initialized: true,
    sv: { freshness: "fresh", analyzedAt: null, minutesAgo: 5, modulesComplete: 6, modulesTotal: 6 },
    rex: {
      exists: true, percentComplete: 50, stats: { total: 2, completed: 1, inProgress: 0, pending: 1, deferred: 0, blocked: 0 },
      hasInProgress: false, hasPending: true, nextTaskTitle: "Next", ...(inbox ? { inbox } : {}),
    },
    hench: { configured: true, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
  };
}

let current: unknown;
let root: HTMLDivElement;

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

async function mount(vnode: VNode): Promise<void> {
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(vnode, root); });
  await settle();
}

// The Inbox is a sibling task's view; any view id exercises the mechanism.
const INBOX: StageSection = { view: "changes", badge: "inbox", openWhenNonEmpty: true };
const rendered: string[] = [];
const section = (s: StageSection = INBOX) => h(BadgedSection, {
  stage: "plan", section: s, navigateTo: vi.fn(),
  renderView: (view) => { rendered.push(view); return h("div", { "data-rendered": view }); },
});
const toggle = () => root.querySelector<HTMLButtonElement>(".stage-section-toggle")!;
const badge = () => root.querySelector<HTMLElement>(".stage-section-badge");

beforeEach(() => {
  localStorage.clear();
  rendered.length = 0;
  flushes.length = 0;
  current = status({ open: 19, appliedUnplaced: 156 });
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    url === "/api/status"
      ? new Response(JSON.stringify(current), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response("{}", { status: 404 })));
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

describe("stage section badge", () => {
  it("shows the open Inbox count after the title, with an accessible label", async () => {
    localStorage.setItem("ndx.stage-sections", JSON.stringify({ "plan:changes": false }));
    await mount(section());
    // Collapsed, the view is not mounted, yet the count shows.
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(rendered).toEqual([]);
    expect(badge()?.dataset.count).toBe("19");
    expect(badge()?.textContent).toContain("19");
    expect(badge()?.querySelector(".sr-only")?.textContent).toBe("19 changes in the Inbox");
    expect(toggle().textContent).toContain("19 changes in the Inbox");
    expect(badge()?.previousElementSibling?.className).toBe("stage-section-title");
  });

  it("follows a placement on rex:prd-changed, without a reload", async () => {
    localStorage.setItem("ndx.stage-sections", JSON.stringify({ "plan:changes": false }));
    await mount(section());
    current = status({ open: 1, appliedUnplaced: 156 });
    act(() => { for (const onFlush of [...flushes]) onFlush({ types: new Set(["rex:prd-changed"]) }); });
    await settle();
    expect(badge()?.dataset.count).toBe("1");
    expect(badge()?.querySelector(".sr-only")?.textContent).toBe("1 change in the Inbox");
  });

  it("shows no pill when status has no Inbox (v1)", async () => {
    current = status();
    await mount(section());
    expect(badge()).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("openWhenNonEmpty", () => {
  it("opens by default while the count is above zero", async () => {
    await mount(section());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(rendered).toContain("changes");
  });

  it("stays closed by default at zero", async () => {
    current = status({ open: 0, appliedUnplaced: 3 });
    await mount(section());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(badge()?.dataset.count).toBe("0");
  });

  it("respects a stored closed choice while non-empty, and a stored open one at zero", async () => {
    localStorage.setItem("ndx.stage-sections", JSON.stringify({ "plan:changes": false }));
    await mount(section());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    render(null, root);
    root.remove();

    current = status({ open: 0, appliedUnplaced: 0 });
    localStorage.setItem("ndx.stage-sections", JSON.stringify({ "plan:changes": true }));
    await mount(section());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("stores the user's toggle, which then outlasts a count change", async () => {
    await mount(section());
    act(() => { toggle().click(); });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(JSON.parse(localStorage.getItem("ndx.stage-sections")!)).toMatchObject({ "plan:changes": false });
    current = status({ open: 25, appliedUnplaced: 0 });
    act(() => { for (const onFlush of [...flushes]) onFlush({ types: new Set(["rex:prd-changed"]) }); });
    await settle();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("is ignored without the option: the badge alone does not open the section", async () => {
    await mount(section({ view: "changes", badge: "inbox" }));
    expect(badge()?.dataset.count).toBe("19");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });
});
