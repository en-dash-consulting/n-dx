// @vitest-environment jsdom
/**
 * Ghost rows (UX5): while a Sidecar change-set card waits, the Plan tree
 * shows its proposed items as dimmed "proposed" rows under their parents.
 * They go when the card is denied and give way to the real items once
 * approval has written them; `useSidecarProposals` reads the cards again on
 * every `sidecar:card` announcement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { useMemo } from "preact/hooks";
import { act } from "preact/test-utils";
import { PRDTree } from "../../../src/viewer/components/prd-tree/prd-tree.js";
import { ghostRowsByParent, type GhostSource } from "../../../src/viewer/components/prd-tree/ghost-rows.js";
import type { PRDDocumentData } from "../../../src/viewer/components/prd-tree/types.js";
import { useSidecarProposals } from "../../../src/viewer/hooks/use-sidecar-proposals.js";

const CARD: GhostSource = {
  id: "card-1",
  changeSet: {
    layout: "v1",
    items: [
      { title: "Refund flow", type: "epic" },
      { title: "Refund form", type: "feature", parent: 0 },
      { title: "Retry declined cards", type: "task", parentId: "feature-1", duplicate: { id: "t", title: "t", type: "task", status: "pending" } },
    ],
  },
};

const DOC: PRDDocumentData = {
  schema: "rex/v1",
  title: "Plan",
  items: [{
    id: "epic-1",
    title: "Checkout hardening",
    status: "pending",
    level: "epic",
    children: [{ id: "feature-1", title: "Card payments", status: "pending", level: "feature" }],
  }],
};

describe("ghostRowsByParent", () => {
  it("hangs each item under its existing parent, or under an earlier item of its card, or with the roots", () => {
    const rows = ghostRowsByParent([CARD]);
    expect(rows.get(null)?.map((r) => [r.title, r.depth])).toEqual([["Refund flow", 0], ["Refund form", 1]]);
    expect(rows.get("feature-1")?.map((r) => [r.title, r.depth, r.duplicate])).toEqual([["Retry declined cards", 0, true]]);
  });

  it("draws nothing for a card with no change set", () => {
    expect(ghostRowsByParent([{ id: "x" }]).size).toBe(0);
  });
});

// ── The tree ───────────────────────────────────────────────────────────────

let root: HTMLDivElement;

function Tree({ doc, cards }: { doc: PRDDocumentData; cards: GhostSource[] }) {
  const ghostRows = useMemo(() => ghostRowsByParent(cards), [cards]);
  return h(PRDTree, { document: doc, defaultExpandDepth: 3, ghostRows });
}

async function draw(doc: PRDDocumentData, cards: GhostSource[]): Promise<void> {
  await act(async () => { render(h(Tree, { doc, cards }), root); });
}

const ghosts = () => [...root.querySelectorAll<HTMLElement>(".prd-ghost-row")];
const rowTitles = () => [...root.querySelectorAll(".prd-node-row:not(.prd-ghost-row) .prd-node-title")].map((n) => n.textContent);

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(async () => {
  await act(async () => { render(null, root); });
  root.remove();
  vi.unstubAllGlobals();
});

describe("ghost rows in the tree", () => {
  it("draws a waiting card's items as dimmed proposed rows under their parents", async () => {
    await draw(DOC, [CARD]);
    const rows = ghosts();
    expect(rows.map((r) => r.querySelector(".prd-node-title")?.textContent)).toEqual(["Refund flow", "Refund form", "Retry declined cards"]);
    expect(rows.every((r) => r.querySelector(".prd-ghost-badge")?.textContent === "proposed")).toBe(true);
    expect(rows.every((r) => r.getAttribute("aria-disabled") === "true" && !r.hasAttribute("data-node-id"))).toBe(true);
    // Indented one level below the row it hangs under.
    expect(rows[0].style.paddingLeft).toBe("8px");
    expect(rows[1].style.paddingLeft).toBe("32px");
    const feature = root.querySelector<HTMLElement>('[data-node-id="feature-1"]')!;
    expect(feature.nextElementSibling).toBe(rows[2]);
    expect(rows[2].style.paddingLeft).toBe(`${parseInt(feature.style.paddingLeft, 10) + 24}px`);
    expect(rows[2].querySelector(".prd-ghost-duplicate")).not.toBeNull();
  });

  it("drops the rows when the card is denied", async () => {
    await draw(DOC, [CARD]);
    await draw(DOC, []);
    expect(ghosts()).toEqual([]);
    expect(rowTitles()).toEqual(["Checkout hardening", "Card payments"]);
  });

  it("replaces the rows with the real items once approval has written them", async () => {
    await draw(DOC, [CARD]);
    const written: PRDDocumentData = {
      ...DOC,
      items: [
        {
          ...DOC.items[0],
          children: [{
            ...DOC.items[0].children![0],
            children: [{ id: "n3", title: "Retry declined cards", status: "pending", level: "task" }],
          }],
        },
        { id: "n1", title: "Refund flow", status: "pending", level: "epic", children: [{ id: "n2", title: "Refund form", status: "pending", level: "feature" }] },
      ],
    };
    await draw(written, []);
    expect(ghosts()).toEqual([]);
    // The new epic arrives collapsed (expansion is the tree's own state), its feature inside it.
    expect(rowTitles()).toEqual(["Checkout hardening", "Card payments", "Retry declined cards", "Refund flow"]);
    expect(root.querySelector('[data-node-id="n3"]')).not.toBeNull();
    expect(root.querySelector('[data-node-id="n1"]')?.getAttribute("aria-expanded")).toBe("false");
  });

  it("draws root proposals on an empty PRD", async () => {
    await draw({ schema: "rex/v1", title: "Plan", items: [] }, [CARD]);
    expect(ghosts().map((r) => r.querySelector(".prd-node-title")?.textContent)).toEqual(["Refund flow", "Refund form"]);
  });
});

// ── The proposals read ─────────────────────────────────────────────────────

class FakeSocket {
  static open = new Set<FakeSocket>();
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor() { FakeSocket.open.add(this); }
  close() { FakeSocket.open.delete(this); }
}

describe("useSidecarProposals", () => {
  let served: GhostSource[];
  let seen: GhostSource[][];

  function Probe({ enabled }: { enabled: boolean }) {
    seen.push(useSidecarProposals(enabled));
    return null;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }

  beforeEach(() => {
    served = [CARD];
    seen = [];
    FakeSocket.open.clear();
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toBe("/api/sidecar/proposals");
      return new Response(JSON.stringify({ cards: served }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });

  it("reads the proposals, and again on each sidecar:card announcement", async () => {
    await act(async () => { render(h(Probe, { enabled: true }), root); });
    await settle();
    expect(seen.at(-1)?.map((c) => c.id)).toEqual(["card-1"]);

    served = [];
    await act(async () => {
      for (const socket of FakeSocket.open) socket.onmessage?.({ data: JSON.stringify({ type: "sidecar:card", cardId: "card-1", status: "denied" }) });
    });
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 150)); });
    await settle();
    expect(seen.at(-1)).toEqual([]);
  });

  it("reads nothing and opens no socket with web.sidecar off", async () => {
    await act(async () => { render(h(Probe, { enabled: false }), root); });
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(FakeSocket.open.size).toBe(0);
    expect(seen.at(-1)).toEqual([]);
  });
});
