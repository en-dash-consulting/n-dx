import { describe, it, expect, vi } from "vitest";
import {
  AdmissionGate,
  AdmissionQueue,
  decideAdmission,
  sameQueueEntry,
  type AdmissionLimits,
  type QueueEntry,
} from "../../../src/hub/admission.js";

/**
 * The admission policy and the queue that holds what it turns away.
 *
 * Everything the gate measures is injected — how many runs are in flight, how
 * much memory is free, whether a start succeeded — so the decisions are
 * exercised without a machine in any particular state. The end-to-end version,
 * with real project servers behind the proxy, is in
 * tests/integration/hub-admission.test.ts.
 */

const LIMITS: AdmissionLimits = { maxSessions: 2, memoryFloorBytes: 1_000 };
const GIB = 1024 * 1024 * 1024;

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    projectId: "alpha",
    workspace: null,
    taskId: "t1",
    enqueuedAt: "2026-09-16T10:00:00.000Z",
    ...overrides,
  };
}

describe("decideAdmission", () => {
  it("admits below the session cap with memory to spare", () => {
    expect(decideAdmission({ running: 0, freeMemoryBytes: 8 * GIB }, LIMITS)).toEqual({ admit: true });
    expect(decideAdmission({ running: 1, freeMemoryBytes: 8 * GIB }, LIMITS)).toEqual({ admit: true });
  });

  it("refuses at the cap, and names capacity rather than memory", () => {
    expect(decideAdmission({ running: 2, freeMemoryBytes: 8 * GIB }, LIMITS))
      .toEqual({ admit: false, reason: "at-capacity" });
    // Over the cap (a run the hub did not start) is still at capacity.
    expect(decideAdmission({ running: 9, freeMemoryBytes: 8 * GIB }, LIMITS))
      .toEqual({ admit: false, reason: "at-capacity" });
  });

  it("refuses below the memory floor even with sessions free", () => {
    expect(decideAdmission({ running: 0, freeMemoryBytes: 500 }, LIMITS))
      .toEqual({ admit: false, reason: "low-memory" });
    // The floor itself is not enough room — it is the line, not the target.
    expect(decideAdmission({ running: 0, freeMemoryBytes: 1_000 }, LIMITS))
      .toEqual({ admit: false, reason: "low-memory" });
    expect(decideAdmission({ running: 0, freeMemoryBytes: 1_001 }, LIMITS)).toEqual({ admit: true });
  });

  it("reports capacity first when both are exhausted — it is the actionable one", () => {
    expect(decideAdmission({ running: 5, freeMemoryBytes: 1 }, LIMITS))
      .toEqual({ admit: false, reason: "at-capacity" });
  });
});

describe("AdmissionQueue", () => {
  it("is FIFO across projects and reports 1-based positions", () => {
    const queue = new AdmissionQueue();
    expect(queue.enqueue(entry({ taskId: "a" }))).toEqual({ position: 1, added: true });
    expect(queue.enqueue(entry({ projectId: "beta", taskId: "b" }))).toEqual({ position: 2, added: true });
    expect(queue.enqueue(entry({ taskId: "c" }))).toEqual({ position: 3, added: true });

    expect(queue.list().map((e) => e.taskId)).toEqual(["a", "b", "c"]);
    expect(queue.shift()?.taskId).toBe("a");
    expect(queue.list().map((e) => e.taskId)).toEqual(["b", "c"]);
    expect(queue.length).toBe(2);
  });

  it("does not queue the same task twice, and does not move it", () => {
    const queue = new AdmissionQueue();
    queue.enqueue(entry({ taskId: "a" }));
    queue.enqueue(entry({ taskId: "b" }));

    // A double-clicked button: same position, nothing added.
    expect(queue.enqueue(entry({ taskId: "a" }))).toEqual({ position: 1, added: false });
    expect(queue.length).toBe(2);
  });

  it("tells apart the same task in different workspaces and projects", () => {
    const queue = new AdmissionQueue();
    queue.enqueue(entry({ taskId: "t1", workspace: null }));
    queue.enqueue(entry({ taskId: "t1", workspace: "feature" }));
    queue.enqueue(entry({ taskId: "t1", projectId: "beta" }));
    expect(queue.length).toBe(3);

    expect(sameQueueEntry(entry({ workspace: "feature" }), { projectId: "alpha", workspace: "feature", taskId: "t1" })).toBe(true);
    expect(sameQueueEntry(entry({ workspace: "feature" }), { projectId: "alpha", workspace: null, taskId: "t1" })).toBe(false);
  });

  it("drops everything for a project that is gone, keeping the rest in order", () => {
    const queue = new AdmissionQueue();
    queue.enqueue(entry({ taskId: "a1" }));
    queue.enqueue(entry({ projectId: "beta", taskId: "b1" }));
    queue.enqueue(entry({ taskId: "a2" }));
    queue.enqueue(entry({ projectId: "beta", taskId: "b2" }));

    expect(queue.dropProject("alpha")).toBe(2);
    expect(queue.list().map((e) => e.taskId)).toEqual(["b1", "b2"]);
    expect(queue.dropProject("gamma")).toBe(0);
  });

  it("puts a failed start back at the head, not the tail", () => {
    const queue = new AdmissionQueue();
    queue.enqueue(entry({ taskId: "a" }));
    queue.enqueue(entry({ taskId: "b" }));
    const head = queue.shift()!;
    queue.unshift(head);
    expect(queue.list().map((e) => e.taskId)).toEqual(["a", "b"]);
  });

  it("reports 0 for a task it is not holding", () => {
    const queue = new AdmissionQueue();
    queue.enqueue(entry({ taskId: "a" }));
    expect(queue.positionOf({ projectId: "alpha", workspace: null, taskId: "a" })).toBe(1);
    expect(queue.positionOf({ projectId: "alpha", workspace: null, taskId: "z" })).toBe(0);
  });
});

describe("AdmissionGate", () => {
  function makeGate(opts: {
    running?: number;
    freeMemory?: number;
    limits?: AdmissionLimits;
    start?: (entry: QueueEntry) => Promise<boolean>;
  } = {}) {
    const state = { running: opts.running ?? 0, freeMemory: opts.freeMemory ?? 8 * GIB };
    const started: QueueEntry[] = [];
    const gate = new AdmissionGate({
      limits: opts.limits ?? LIMITS,
      countRunning: async () => state.running,
      freeMemory: () => state.freeMemory,
      start: opts.start ?? (async (e) => { started.push(e); state.running++; return true; }),
      drainIntervalMs: 10_000, // tests drain explicitly
    });
    return { gate, state, started };
  }

  it("admits while there is room and nothing is waiting", async () => {
    const { gate } = makeGate();
    expect(await gate.admit({ projectId: "alpha", workspace: null, taskId: "t1" }))
      .toEqual({ admitted: true, position: 0 });
    expect(gate.queue.length).toBe(0);
  });

  it("queues at the cap and reports the position", async () => {
    const { gate } = makeGate({ running: 2 });
    expect(await gate.admit({ projectId: "alpha", workspace: null, taskId: "t1" }))
      .toEqual({ admitted: false, position: 1, reason: "at-capacity" });
    expect(await gate.admit({ projectId: "beta", workspace: null, taskId: "t2" }))
      .toEqual({ admitted: false, position: 2, reason: "at-capacity" });
  });

  it("queues below the memory floor and says why", async () => {
    const { gate } = makeGate({ freeMemory: 10 });
    const result = await gate.admit({ projectId: "alpha", workspace: null, taskId: "t1" });
    expect(result).toEqual({ admitted: false, position: 1, reason: "low-memory" });
    expect(gate.snapshot().memoryPaused).toBe(true);
  });

  it("makes a late arrival wait behind the queue even once a slot frees", async () => {
    const { gate, state } = makeGate({ running: 2 });
    await gate.admit({ projectId: "alpha", workspace: null, taskId: "first" });

    // A run finishes, but someone else is already waiting.
    state.running = 1;
    const late = await gate.admit({ projectId: "beta", workspace: null, taskId: "late" });
    expect(late.admitted).toBe(false);
    expect(late.position).toBe(2);
    expect(gate.queue.list().map((e) => e.taskId)).toEqual(["first", "late"]);
  });

  it("drains in order as capacity frees, one slot at a time", async () => {
    const { gate, state, started } = makeGate({ running: 2 });
    await gate.admit({ projectId: "alpha", workspace: null, taskId: "a" });
    await gate.admit({ projectId: "beta", workspace: "feature", taskId: "b" });
    await gate.admit({ projectId: "alpha", workspace: null, taskId: "c" });

    // One slot frees: exactly one run starts, and it is the first queued.
    state.running = 1;
    expect(await gate.drain()).toBe(1);
    expect(started.map((e) => e.taskId)).toEqual(["a"]);
    expect(gate.queue.list().map((e) => e.taskId)).toEqual(["b", "c"]);

    // Two more free: the rest go, still in order, workspace carried along.
    state.running = 0;
    expect(await gate.drain()).toBe(2);
    expect(started.map((e) => e.taskId)).toEqual(["a", "b", "c"]);
    expect(started[1].workspace).toBe("feature");
    expect(gate.queue.length).toBe(0);
  });

  it("does not drain while memory is below the floor", async () => {
    const { gate, state, started } = makeGate({ running: 2 });
    await gate.admit({ projectId: "alpha", workspace: null, taskId: "a" });

    state.running = 0;
    state.freeMemory = 10;
    expect(await gate.drain()).toBe(0);
    expect(started).toEqual([]);
    expect(gate.queue.length).toBe(1);

    // Memory recovers and the same drain releases it.
    state.freeMemory = 8 * GIB;
    expect(await gate.drain()).toBe(1);
    expect(started.map((e) => e.taskId)).toEqual(["a"]);
  });

  it("drops a queued run its server will not accept, rather than retrying forever", async () => {
    const { gate, state } = makeGate({ running: 2, start: async () => false });
    await gate.admit({ projectId: "gone", workspace: null, taskId: "a" });
    await gate.admit({ projectId: "alpha", workspace: null, taskId: "b" });

    // Capacity frees, so both are attempted; neither is accepted.
    state.running = 0;
    expect(await gate.drain()).toBe(0);
    expect(gate.queue.length).toBe(0);
  });

  it("drops a run whose start throws, for the same reason", async () => {
    const { gate, state } = makeGate({
      running: 2,
      start: async () => { throw new Error("connect ECONNREFUSED"); },
    });
    await gate.admit({ projectId: "gone", workspace: null, taskId: "a" });

    state.running = 0;
    expect(await gate.drain()).toBe(0);
    expect(gate.queue.length).toBe(0);
  });

  it("forgets what was queued for an unregistered project", async () => {
    const { gate } = makeGate({ running: 2 });
    await gate.admit({ projectId: "alpha", workspace: null, taskId: "a" });
    await gate.admit({ projectId: "beta", workspace: null, taskId: "b" });

    gate.forgetProject("alpha");
    expect(gate.queue.list().map((e) => e.projectId)).toEqual(["beta"]);
  });

  it("reports what it measured, with the limits it measured against", async () => {
    const { gate } = makeGate({ running: 2, freeMemory: 3 * GIB });
    await gate.admit({ projectId: "alpha", workspace: null, taskId: "a" });

    const snapshot = gate.snapshot();
    expect(snapshot).toMatchObject({
      running: 2,
      freeMemoryBytes: 3 * GIB,
      limits: LIMITS,
      memoryPaused: false,
    });
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({ projectId: "alpha", taskId: "a" });
    expect(Date.parse(snapshot.entries[0].enqueuedAt)).not.toBeNaN();
  });

  it("notifies on every change, so a reporter never has to poll to notice", async () => {
    const onChange = vi.fn();
    const gate = new AdmissionGate({
      limits: LIMITS,
      countRunning: async () => 2,
      freeMemory: () => 8 * GIB,
      start: async () => true,
      onChange,
    });
    await gate.admit({ projectId: "alpha", workspace: null, taskId: "a" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].entries).toHaveLength(1);
    gate.stop();
  });

  it("counts a failed measurement as nothing running rather than blocking everything", async () => {
    const gate = new AdmissionGate({
      limits: LIMITS,
      countRunning: async () => { throw new Error("children unreachable"); },
      freeMemory: () => 8 * GIB,
      start: async () => true,
    });
    expect(await gate.admit({ projectId: "alpha", workspace: null, taskId: "a" }))
      .toEqual({ admitted: true, position: 0 });
    gate.stop();
  });
});
