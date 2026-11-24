// @vitest-environment jsdom
/**
 * A PRD card whose item active work holds (`heldBy`): the drawer warns that a
 * run or a claim in another worktree is on it, and Approve takes two presses,
 * the second sending `acknowledgeHeld`. ⌘↵ follows the same two steps.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { SidecarCards } from "../../../src/viewer/components/sidecar-cards.js";
import type { SidecarCard, SidecarCardDecision } from "../../../src/viewer/hooks/use-sidecar.js";

const MANIFEST = { cliNames: ["ndx"], effects: {}, layoutPaths: {} };
const HELD = { itemId: "t1", taskId: "t1", taskTitle: "Task one", worktree: "wt-a", worktreePath: "/repo/wt-a", source: "run" as const };

function statusCard(over: Partial<SidecarCard> = {}): SidecarCard {
  return {
    id: "c1", sessionId: "s1", tool: "propose_status", kind: "status", allowListKey: null,
    input: { id: "t1", status: "deferred" },
    statusChange: { itemId: "t1", itemTitle: "Task one", from: "pending", to: "deferred", rule: { allowed: true } },
    status: "pending", raisedAt: "2026-11-20T00:00:01.000Z", ...over,
  } as SidecarCard;
}

let host: HTMLElement | null = null;
const decide = vi.fn(async (_id: string, _decision: SidecarCardDecision) => true);

async function mount(card: SidecarCard): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => { render(h(SidecarCards, { cards: [card], manifest: MANIFEST, decide }), host!); });
  return host;
}

afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = null;
  decide.mockClear();
});

const approve = (el: HTMLElement) => el.querySelector<HTMLButtonElement>(".sidecar-card-approve")!;

describe("held card", () => {
  it("warns that an active run in another worktree is on the item", async () => {
    const el = await mount(statusCard({ heldBy: HELD }));
    const warning = el.querySelector(".sidecar-card-held");
    expect(warning?.textContent).toContain("Being worked by an active run in wt-a — approving changes it under that run.");
    expect(warning?.textContent).toContain("Task Task one (t1)");
    expect(warning?.getAttribute("title")).toBe("/repo/wt-a");
  });

  it("names a claim, and an item above the held task", async () => {
    const el = await mount(statusCard({ heldBy: { ...HELD, itemId: "c9", source: "claim" } }));
    const warning = el.querySelector(".sidecar-card-held")!.textContent!;
    expect(warning).toContain("Claimed by wt-a for a run — approving changes it under that claim.");
    expect(warning).toContain("c9 is above task Task one (t1)");
  });

  it("arms Approve on the first press and approves with acknowledgeHeld on the second", async () => {
    const el = await mount(statusCard({ heldBy: HELD }));
    await act(async () => { approve(el).click(); });
    expect(decide).not.toHaveBeenCalled();
    expect(approve(el).textContent).toBe("Confirm: write under the active work");
    expect(approve(el).classList.contains("is-confirming")).toBe(true);
    await act(async () => { approve(el).click(); });
    expect(decide).toHaveBeenCalledWith("c1", { approve: true, acknowledgeHeld: true });
  });

  it("takes two ⌘↵ presses too, and a deny goes at once", async () => {
    const el = await mount(statusCard({ heldBy: HELD }));
    const press = async () => {
      await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })); });
    };
    await press();
    expect(decide).not.toHaveBeenCalled();
    await press();
    expect(decide).toHaveBeenCalledWith("c1", { approve: true, acknowledgeHeld: true });

    decide.mockClear();
    await act(async () => { el.querySelector<HTMLButtonElement>(".sidecar-card-deny")!.click(); });
    expect(decide).toHaveBeenCalledWith("c1", { approve: false, reason: "" });
  });

  it("approves at once and shows no warning when nothing holds the item", async () => {
    const el = await mount(statusCard());
    expect(el.querySelector(".sidecar-card-held")).toBeNull();
    await act(async () => { approve(el).click(); });
    expect(decide).toHaveBeenCalledWith("c1", { approve: true });
  });

  it("keeps a one-line record on a card approved over the warning", async () => {
    const el = await mount(statusCard({ heldBy: HELD, heldAcknowledged: true, status: "approved", decidedAt: "2026-11-20T00:00:02.000Z" }));
    expect(el.querySelector(".sidecar-card-held-note")?.textContent).toBe("Approved over active work in wt-a");
    expect(el.querySelector(".sidecar-card-approve")).toBeNull();
  });
});
