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
import { SidecarCards, runPlanCommands, runPlanRestartPrompt } from "../../../src/viewer/components/sidecar-cards.js";
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

  const decided = (over: Partial<SidecarCard> = {}) =>
    planCard({ status: "approved", lane: 0, decidedAt: "2026-10-29T00:00:02.000Z", ...over });
  const workCard = (over: Partial<SidecarCard> = {}): SidecarCard => ({
    id: "w1",
    sessionId: "s1",
    tool: "start_work",
    kind: "work",
    input: { taskId: "t1" },
    allowListKey: null,
    status: "pending",
    raisedAt: "2026-10-29T00:00:03.000Z",
    ...over,
  });
  const badges = (el: HTMLElement) => ({
    started: el.querySelector(".sidecar-run-plan-started")?.textContent ?? null,
    raised: el.querySelector(".sidecar-run-plan-raised")?.textContent ?? null,
  });

  async function drawAll(cards: SidecarCard[]) {
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      render(h(SidecarCards, { cards, manifest: null, decide: vi.fn(async () => {}) }), host!);
    });
    return host;
  }

  it("after Start lane the lane reads Work card raised, not Started, and still copies", async () => {
    const el = await drawAll([decided()]);
    expect(el.querySelector(".sidecar-run-plan-start")).toBeNull();
    expect(badges(el)).toEqual({ started: null, raised: "Work card raised" });
    await act(async () => { el.querySelector<HTMLButtonElement>(".sidecar-run-plan-copy")!.click(); });
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("reads Work card raised while the lane's work card waits", async () => {
    const el = await drawAll([decided(), workCard()]);
    expect(badges(el)).toEqual({ started: null, raised: "Work card raised" });
  });

  it("reads Started only once the work card is approved and its run started", async () => {
    const el = await drawAll([decided(), workCard({ status: "approved", carriedOut: { ok: true } })]);
    expect(badges(el)).toEqual({ started: "Started", raised: null });
    expect(el.querySelectorAll(".sidecar-run-plan-lane")[1].querySelector(".sidecar-run-plan-started")).toBeNull();
  });

  it.each([
    ["denied", { status: "denied" }],
    ["withdrawn", { status: "withdrawn", reason: "the turn stopped" }],
    ["approved but refused to start", { status: "approved", carriedOut: { ok: false } }],
  ] as const)("returns to unstarted when the work card is %s", async (_name, over) => {
    const el = await drawAll([decided(), workCard({ ...over })]);
    expect(badges(el)).toEqual({ started: null, raised: null });
  });

  it.each([
    ["denied", { status: "denied" }],
    ["withdrawn", { status: "withdrawn", reason: "the turn stopped" }],
  ] as const)("offers Start lane again on the chosen lane when its work card is %s, and sends a turn instead of deciding", async (_name, over) => {
    const send = vi.fn(async (_prompt: string) => true);
    const decide = vi.fn(async () => {});
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      render(h(SidecarCards, { cards: [decided(), workCard({ ...over })], manifest: null, decide, send }), host!);
    });
    const starts = host.querySelectorAll<HTMLButtonElement>(".sidecar-run-plan-start");
    expect(starts).toHaveLength(1);
    expect(host.querySelectorAll(".sidecar-run-plan-lane")[0].contains(starts[0])).toBe(true);
    await act(async () => { starts[0].click(); });
    expect(send).toHaveBeenCalledExactlyOnceWith(runPlanRestartPrompt(decided(), 0));
    expect(send.mock.calls[0][0]).toContain("task t1");
    expect(send.mock.calls[0][0]).toContain("Do not propose a new run plan");
    expect(decide).not.toHaveBeenCalled();
  });

  it("offers no Start lane while the work card waits, after it started, or before any work card was raised", async () => {
    for (const cards of [[decided(), workCard()], [decided(), workCard({ status: "approved", carriedOut: { ok: true } })], [decided()]]) {
      host = document.createElement("div");
      document.body.appendChild(host);
      await act(async () => {
        render(h(SidecarCards, { cards, manifest: null, decide: vi.fn(async () => {}), send: vi.fn(async () => true) }), host!);
      });
      expect(host.querySelector(".sidecar-run-plan-start")).toBeNull();
      await act(async () => { render(null, host!); });
      host.remove();
      host = null;
    }
  });

  it("ignores a work card for another task or one raised before the plan was decided", async () => {
    const el = await drawAll([
      decided(),
      workCard({ id: "w0", status: "approved", carriedOut: { ok: true }, raisedAt: "2026-10-29T00:00:01.500Z" }),
      workCard({ id: "w2", input: { taskId: "t2" }, status: "approved", carriedOut: { ok: true } }),
    ]);
    expect(badges(el)).toEqual({ started: null, raised: "Work card raised" });
  });
});
