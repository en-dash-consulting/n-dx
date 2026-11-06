// @vitest-environment jsdom
/**
 * Every runnable row names its change on a v2 tree ("<task> · in <change>",
 * or "<change> · runs as one task"), and the run controls say Start and
 * Live run. The server builds the words once (shared/runnable-row.ts); the
 * viewer draws them. A v1 tree has no change in a chain, so its rows keep the
 * bare title and the ancestors line.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { runnableRowText, withPlannedRowText } from "../../../src/server/runnable-row.js";
import type { QueuePlan } from "../../../src/shared/index.js";
import { runnableRowParts } from "../../../src/viewer/views/live-model.js";
import { VIEW_META } from "../../../src/viewer/views/view-meta.js";
import { StartTaskButton } from "../../../src/viewer/components/start-task-button.js";
import { ReadyNext } from "../../../src/viewer/views/live-ready-next.js";
import { SidecarCards } from "../../../src/viewer/components/sidecar-cards.js";
import type { SidecarCard } from "../../../src/viewer/hooks/use-sidecar.js";

const V2_CHAIN = [{ title: "Billing", itemType: "capability" }, { title: "Retry failed charges", itemType: "change" }];
const V1_CHAIN = [{ title: "Billing", itemType: "epic" }, { title: "Retries", itemType: "feature" }];

describe("runnableRowText", () => {
  it("names the nearest change after the task title", () => {
    expect(runnableRowText({ title: "Add backoff", chain: V2_CHAIN })).toBe("Add backoff · in Retry failed charges");
  });
  it("says a task-less change runs as one task", () => {
    expect(runnableRowText({ title: "Retry failed charges", runsAsOneTask: true })).toBe("Retry failed charges · runs as one task");
  });
  it("keeps the bare title on a v1 chain", () => {
    expect(runnableRowText({ title: "Add backoff", chain: V1_CHAIN })).toBe("Add backoff");
  });
});

describe("Live rows", () => {
  const link = (l: { title: string; itemType: string }, i: number) => ({ id: String(i), ...l });
  it("draw the server's words and drop the ancestors line", () => {
    const row = runnableRowParts({ epicChain: V2_CHAIN.map(link), rowText: "Add backoff · in Retry failed charges" }, "Add backoff");
    expect(row).toEqual({ text: "Add backoff · in Retry failed charges", chain: null });
  });
  it("keep the v1 title and ancestors", () => {
    const row = runnableRowParts({ epicChain: V1_CHAIN.map(link), rowText: "Add backoff" }, "Add backoff");
    expect(row).toEqual({ text: "Add backoff", chain: "Billing › Retries" });
  });
});

const RAW_PLAN: QueuePlan = {
  lanes: [
    {
      command: "ndx work --task=t1 --auto .",
      changeId: "ch1",
      changeTitle: "Retry failed charges",
      tasks: [{ id: "t1", title: "Add backoff", reason: "ready" }],
    },
    {
      command: "ndx work --task=ch2 --auto .",
      changeId: "ch2",
      changeTitle: "Export invoices",
      tasks: [{ id: "ch2", title: "Export invoices", reason: "ready" }],
    },
  ],
  excluded: [],
  activeRuns: 0,
  runLimit: 3,
  summary: "2 tracks",
};
const PLAN = withPlannedRowText(RAW_PLAN);

describe("plan rows", () => {
  it("name the lane's change, or say a task-less change runs as one task", () => {
    expect(PLAN.lanes.map((l) => l.tasks[0].rowText)).toEqual([
      "Add backoff · in Retry failed charges",
      "Export invoices · runs as one task",
    ]);
  });
  it("keep the bare title from a planner that sends no change title", () => {
    const bare = withPlannedRowText({ ...RAW_PLAN, lanes: [{ ...RAW_PLAN.lanes[0], changeTitle: undefined }] });
    expect(bare.lanes[0].tasks[0].rowText).toBe("Add backoff");
  });
});

let host: HTMLElement | null = null;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (host) {
    await act(async () => { render(null, host!); });
    host.remove();
    host = null;
  }
});

async function draw(node: ReturnType<typeof h>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => { render(node, host!); });
  return host;
}

describe("rendered rows", () => {
  it("Live's Ready next lists the planned tasks with their change", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => PLAN })));
    const el = await draw(h(ReadyNext, { refreshKey: "k", navigateTo: () => {} }));
    await act(async () => { await Promise.resolve(); });
    expect([...el.querySelectorAll(".live-ready-task .live-card-title")].map((n) => n.textContent)).toEqual([
      "Add backoff · in Retry failed charges",
      "Export invoices · runs as one task",
    ]);
  });

  it("the Sidecar run-plan card and work card name the change", async () => {
    const plan = {
      id: "p", sessionId: "s", tool: "propose_run_plan", kind: "run-plan", input: {}, allowListKey: null,
      runPlan: PLAN, status: "pending", raisedAt: "2026-11-06T10:00:00.000Z",
    } as unknown as SidecarCard;
    const work = {
      id: "w", sessionId: "s", tool: "start_work", kind: "work", input: { taskId: "t1" }, allowListKey: null,
      rowText: "Add backoff · in Retry failed charges", status: "pending", raisedAt: "2026-11-06T10:00:01.000Z",
    } as unknown as SidecarCard;
    const el = await draw(h(SidecarCards, { cards: [plan, work], manifest: null, decide: vi.fn(async () => true) }));
    expect([...el.querySelectorAll(".sidecar-run-plan-task-title")].map((n) => n.textContent)).toEqual([
      "Add backoff · in Retry failed charges (starts first)",
      "Export invoices · runs as one task (starts first)",
    ]);
    expect(el.querySelector(".sidecar-card-runnable")?.textContent).toBe("Add backoff · in Retry failed charges");
  });
});

describe("run controls", () => {
  it("the Live view is labelled Live run", () => {
    expect(VIEW_META["live-task"].label).toBe("Live run");
  });
  it("the start button says Start by default", async () => {
    const el = await draw(h(StartTaskButton, { taskId: "t1", onStarted: () => {} }));
    expect(el.textContent).toContain("Start");
    expect(el.textContent).not.toContain("Start Task");
  });
});
