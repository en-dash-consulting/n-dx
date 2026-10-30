// @vitest-environment jsdom
/**
 * The run-plan card (Guide) in the Sidecar drawer: the planner's lanes with
 * each task's exact command; Copy commands, a clipboard write with no broker
 * call; and Start lane, the only way to approve it, which names the lane and
 * starts nothing itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { SidecarCards, runPlanCommands } from "../../../src/viewer/components/sidecar-cards.js";
import type { SidecarCard, SidecarCardDecision } from "../../../src/viewer/hooks/use-sidecar.js";
import type { QueuePlan } from "../../../src/shared/index.js";

const PLAN: QueuePlan = {
  lanes: [
    {
      command: "ndx work --task=t1 --auto . && ndx work --task=t2 --auto .",
      changeId: "ch1",
      tasks: [
        { id: "t1", title: "Wire the button", reason: "ready; first in its change" },
        { id: "t2", title: "Style the button", reason: "follows t1" },
      ],
    },
    { command: "ndx work --task=t3 --auto .", changeId: "ch2", tasks: [{ id: "t3", title: "Elsewhere", reason: "ready" }] },
  ],
  excluded: [],
  activeRuns: 1,
  runLimit: 3,
  summary: "2 lanes.",
};

function planCard(over: Partial<SidecarCard> = {}): SidecarCard {
  return {
    id: "p1",
    sessionId: "s1",
    tool: "propose_run_plan",
    kind: "run-plan",
    input: { note: "Two lanes can run side by side." },
    allowListKey: null,
    runPlan: PLAN,
    status: "pending",
    raisedAt: "2026-10-29T00:00:01.000Z",
    ...over,
  };
}

let host: HTMLElement | null = null;
const writeText = vi.fn(async (_text: string) => {});
const fetchSpy = vi.fn();

beforeEach(() => {
  writeText.mockClear();
  fetchSpy.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  vi.stubGlobal("fetch", fetchSpy);
});

async function draw(card: SidecarCard, decide = vi.fn(async (_id: string, _d: SidecarCardDecision) => {})) {
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    render(h(SidecarCards, { cards: [card], manifest: null, decide }), host!);
  });
  return { el: host, decide };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  if (host) {
    await act(async () => { render(null, host!); });
    host.remove();
    host = null;
  }
});

describe("the run-plan card", () => {
  it("lists each lane with every task's exact command, the reasons and the active runs against the limit", async () => {
    const { el } = await draw(planCard());
    expect(el.querySelector(".sidecar-card-kind")?.textContent).toBe("Run plan");
    expect(el.querySelector(".sidecar-card-title")?.textContent).toBe("2 lanes");
    expect(el.querySelector(".sidecar-run-plan-active")?.textContent).toBe("Active runs: 1 of 3");
    const lanes = el.querySelectorAll(".sidecar-run-plan-lane");
    expect(lanes).toHaveLength(2);
    expect(lanes[0].querySelector(".sidecar-run-plan-lane-title")?.textContent).toBe("Lane 1 · change ch1");
    expect([...lanes[0].querySelectorAll(".sidecar-run-plan-command")].map((c) => c.textContent)).toEqual([
      "ndx work --task=t1 --auto .",
      "ndx work --task=t2 --auto .",
    ]);
    expect([...lanes[0].querySelectorAll(".sidecar-run-plan-task-title")].map((c) => c.textContent)).toEqual([
      "Wire the button (starts first)",
      "Style the button",
    ]);
    expect([...lanes[1].querySelectorAll(".sidecar-run-plan-command")].map((c) => c.textContent)).toEqual(["ndx work --task=t3 --auto ."]);
  });

  it("Copy commands copies every lane command, makes no broker call and decides nothing", async () => {
    const { el, decide } = await draw(planCard());
    const copy = el.querySelector<HTMLButtonElement>(".sidecar-run-plan-copy")!;
    expect(copy.textContent).toBe("Copy commands");
    await act(async () => { copy.click(); });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      "ndx work --task=t1 --auto . && ndx work --task=t2 --auto .\nndx work --task=t3 --auto .",
    );
    expect(writeText.mock.calls[0][0]).toBe(runPlanCommands(PLAN));
    expect(decide).not.toHaveBeenCalled();
    // The card's own hooks may read (the CLI name); nothing is posted and no card is decided.
    expect(fetchSpy.mock.calls.filter(([url, init]) => String(url).includes("/cards/") || (init as RequestInit | undefined)?.method === "POST")).toEqual([]);
    expect(el.querySelector(".sidecar-card--pending")).not.toBeNull();
  });

  it("Start lane approves with that lane, and offers no bare Approve", async () => {
    const { el, decide } = await draw(planCard());
    expect(el.querySelector(".sidecar-card-approve")).toBeNull();
    expect(el.querySelector(".sidecar-card-always")).toBeNull();
    const starts = el.querySelectorAll<HTMLButtonElement>(".sidecar-run-plan-start");
    expect(starts).toHaveLength(2);
    await act(async () => { starts[1].click(); });
    expect(decide).toHaveBeenCalledExactlyOnceWith("p1", { approve: true, lane: 1 });
  });

  it("Not now denies, and ⌘↵ is no answer to a run plan", async () => {
    const { el, decide } = await draw(planCard());
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true })); });
    expect(decide).not.toHaveBeenCalled();
    const deny = el.querySelector<HTMLButtonElement>(".sidecar-card-deny")!;
    expect(deny.textContent).toBe("Not now");
    await act(async () => { deny.click(); });
    expect(decide).toHaveBeenCalledExactlyOnceWith("p1", { approve: false, reason: "" });
  });

  it("once decided, shows which lane started, offers no Start lane, and still copies", async () => {
    const { el } = await draw(planCard({ status: "approved", lane: 0 }));
    expect(el.querySelector(".sidecar-run-plan-start")).toBeNull();
    expect(el.querySelector(".sidecar-run-plan-started")?.textContent).toBe("Started");
    await act(async () => { el.querySelector<HTMLButtonElement>(".sidecar-run-plan-copy")!.click(); });
    expect(writeText).toHaveBeenCalledOnce();
  });
});
