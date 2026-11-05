// @vitest-environment jsdom
/**
 * The change-set card (story 11) in the Sidecar drawer: its items as the
 * server read them, editable while it is the first waiting card, the
 * duplicate flags and the v2 placement line, and the edits an approval sends.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { SidecarCards, changeSetEdits, changeSetPlacementLine } from "../../../src/viewer/components/sidecar-cards.js";
import type { SidecarCard, SidecarCardDecision } from "../../../src/viewer/hooks/use-sidecar.js";
import type { SidecarChangeSet } from "../../../src/shared/index.js";

const V1: SidecarChangeSet = {
  layout: "v1",
  items: [
    { title: "Refund flow", type: "epic", description: "Shoppers ask for refunds." },
    { title: "Refund form", type: "feature", parent: 0, acceptanceCriteria: ["It submits"] },
    { title: "Checkout hardening", type: "task", parentId: "feature-1", duplicate: { id: "task-9", title: "Checkout hardening", type: "task", status: "pending" } },
  ],
};

function changeSetCard(changeSet: SidecarChangeSet, over: Partial<SidecarCard> = {}): SidecarCard {
  return {
    id: "c1",
    sessionId: "s1",
    tool: "propose_prd_change",
    kind: "change-set",
    input: { items: changeSet.items.map((i) => ({ title: i.title })) },
    allowListKey: null,
    changeSet,
    status: "pending",
    raisedAt: "2026-10-28T00:00:01.000Z",
    ...over,
  };
}

let host: HTMLElement | null = null;

async function draw(card: SidecarCard, decide = vi.fn(async (_id: string, _d: SidecarCardDecision) => {})) {
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    render(h(SidecarCards, { cards: [card], manifest: null, decide }), host!);
  });
  return { el: host, decide };
}

async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(async () => {
  if (host) {
    await act(async () => { render(null, host!); });
    host.remove();
    host = null;
  }
});

describe("the change-set card", () => {
  it("draws each item with its type, parent and fields, editable while it waits", async () => {
    const { el } = await draw(changeSetCard(V1));
    const items = el.querySelectorAll(".sidecar-change-set-item");
    expect(items).toHaveLength(3);
    expect(items[0].querySelector(".sidecar-change-set-type")?.textContent).toBe("Epic");
    expect(items[1].querySelector(".sidecar-change-set-parent")?.textContent).toBe("under item 1 (Refund flow)");
    expect(items[2].querySelector(".sidecar-change-set-parent")?.textContent).toBe("under feature-1");
    expect(items[0].querySelector<HTMLInputElement>(".sidecar-change-set-title")?.value).toBe("Refund flow");
    expect(items[0].querySelector<HTMLTextAreaElement>(".sidecar-change-set-description")?.value).toBe("Shoppers ask for refunds.");
    expect(items[1].querySelector<HTMLTextAreaElement>(".sidecar-change-set-criteria")?.value).toBe("It submits");
    expect(el.querySelector(".sidecar-card-approve")?.textContent).toBe("Approve and write 3 items");
  });

  it("flags an item that matches an existing item, with the match", async () => {
    const { el } = await draw(changeSetCard(V1));
    const flags = el.querySelectorAll(".sidecar-change-set-duplicate");
    expect(flags).toHaveLength(1);
    expect(flags[0].textContent).toBe(`Matches existing task "Checkout hardening" (task-9, pending)`);
  });

  it("sends the edited title, description and done-when with the approval, and nothing unchanged", async () => {
    const { el, decide } = await draw(changeSetCard(V1));
    const [first, second] = el.querySelectorAll(".sidecar-change-set-item");
    await type(first.querySelector<HTMLInputElement>(".sidecar-change-set-title")!, "Refunds");
    await type(second.querySelector<HTMLTextAreaElement>(".sidecar-change-set-description")!, "A form.");
    await type(second.querySelector<HTMLTextAreaElement>(".sidecar-change-set-criteria")!, "It submits\n\nIt validates");
    await act(async () => { el.querySelector<HTMLButtonElement>(".sidecar-card-approve")!.click(); });
    expect(decide).toHaveBeenCalledWith("c1", {
      approve: true,
      edits: [
        { index: 0, title: "Refunds" },
        { index: 1, description: "A form.", acceptanceCriteria: ["It submits", "It validates"] },
      ],
    });
  });

  it("sends no edits with a denial", async () => {
    const { el, decide } = await draw(changeSetCard(V1));
    await type(el.querySelector<HTMLInputElement>(".sidecar-change-set-title")!, "Refunds");
    await act(async () => { el.querySelector<HTMLButtonElement>(".sidecar-card-deny")!.click(); });
    expect(decide).toHaveBeenCalledWith("c1", { approve: false, reason: "" });
  });

  it("says before approval that an untargeted v2 change lands in the Inbox needing placement", async () => {
    const card = changeSetCard({ layout: "v2", items: [{ title: "Offer Google Pay", type: "change" }], placement: { inbox: true } });
    const { el } = await draw(card);
    expect(el.querySelector(".sidecar-change-set-placement")?.textContent).toContain("lands in the Inbox needing placement");
    expect(changeSetPlacementLine(changeSetCard({ layout: "v2", items: [], placement: { target: "cap-1", title: "Pay by card" } })))
      .toBe("Placed on Pay by card (touches cap-1)");
    expect(changeSetPlacementLine(changeSetCard(V1))).toBeNull();
  });

  it("never offers to apply the change", async () => {
    const card = changeSetCard({ layout: "v2", items: [{ title: "Offer Google Pay", type: "change" }], placement: { inbox: true } });
    const { el } = await draw(card);
    const buttons = [...el.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(buttons.some((t) => /apply/i.test(t))).toBe(false);
  });

  it("draws a written card read-only with the ids it wrote", async () => {
    const card = changeSetCard(V1, { status: "approved", edited: true, carriedOut: { ok: true, ids: ["n1", "n2", "n3"] } });
    const { el } = await draw(card);
    expect(el.querySelector("input.sidecar-change-set-title")).toBeNull();
    expect(el.querySelector(".sidecar-change-set-title code")?.textContent).toBe(" n1");
    expect(el.querySelector(".sidecar-change-set-written")?.textContent).toBe("Written with your edits: 3 items");
  });
});

describe("changeSetEdits", () => {
  it("drops a draft that changes nothing", () => {
    const card = changeSetCard(V1);
    expect(changeSetEdits(card, { 0: { title: "Refund flow ", description: "Shoppers ask for refunds.", criteria: "" } })).toEqual([]);
  });
});
