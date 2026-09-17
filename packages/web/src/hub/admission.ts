/**
 * Admission control for dashboard-started agent runs.
 *
 * Each project server enforces its own concurrency, but nothing enforced the
 * machine's. Four repositories registered with the hub could each start their
 * own runs, and the laptop — not any one project — ran out of memory. The
 * failure mode was the worst kind: the dashboard that asked last got a 503, or
 * nothing at all, while the machine swapped.
 *
 * So execute requests pass through here first. A run is admitted when the
 * machine has room for it — fewer than `maxSessions` in flight across every
 * project, and free memory above `memoryFloorBytes`. Otherwise it is queued
 * rather than refused: the operator asked for the work, and a queue position
 * is a better answer than an error they have to remember to retry.
 *
 * The queue is FIFO across projects, drained by polling rather than by
 * listening for completion events. Polling is what the gate already does to
 * count what is running, the children have no completion callback to the hub,
 * and the alternative — sniffing `hench:task-execution-progress` frames inside
 * the proxy — would mean parsing a WebSocket stream the proxy deliberately
 * pipes as raw bytes. A drain tick a second or two after capacity frees is
 * indistinguishable to anyone watching a run that takes minutes.
 *
 * @module web/hub/admission
 */

import { freemem } from "node:os";

/** Bounds the machine will not exceed, whatever any single project would allow. */
export interface AdmissionLimits {
  /** Dashboard-started runs in flight across every registered project. */
  maxSessions: number;
  /** Free system memory below which nothing new starts. */
  memoryFloorBytes: number;
}

/** What the gate measured when it decided. */
export interface AdmissionSnapshot {
  running: number;
  freeMemoryBytes: number;
}

export type AdmissionReason = "at-capacity" | "low-memory";

export type AdmissionDecision =
  | { admit: true }
  | { admit: false; reason: AdmissionReason };

/** One queued execute request. */
export interface QueueEntry {
  projectId: string;
  /** Workspace (worktree) key the request addressed, or null for the anchor. */
  workspace: string | null;
  taskId: string;
  enqueuedAt: string;
}

export interface QueueSnapshot {
  entries: QueueEntry[];
  running: number;
  freeMemoryBytes: number;
  limits: AdmissionLimits;
  /**
   * True when the gate is holding everything back for memory rather than for
   * the session cap — the distinction the Overview strip shows as
   * "admission paused: low memory", because waiting behind other runs and
   * waiting for the machine to recover are different situations.
   */
  memoryPaused: boolean;
}

/**
 * Whether a request can start now. Pure, so the policy is testable without a
 * machine in a particular state.
 *
 * Capacity is checked before memory only so the reason is the more actionable
 * of the two: at the cap, finishing a run releases the next one; below the
 * floor, nothing the operator does inside n-dx helps.
 */
export function decideAdmission(
  snapshot: AdmissionSnapshot,
  limits: AdmissionLimits,
): AdmissionDecision {
  if (snapshot.running >= limits.maxSessions) return { admit: false, reason: "at-capacity" };
  if (snapshot.freeMemoryBytes <= limits.memoryFloorBytes) return { admit: false, reason: "low-memory" };
  return { admit: true };
}

/** Same entry: the same task, in the same workspace of the same project. */
export function sameQueueEntry(a: QueueEntry, b: Pick<QueueEntry, "projectId" | "workspace" | "taskId">): boolean {
  return a.projectId === b.projectId && a.workspace === b.workspace && a.taskId === b.taskId;
}

/**
 * FIFO across every project.
 *
 * Deliberately not per-project round-robin: the queue exists because the
 * machine is full, and asking first is the only ordering anyone can predict.
 * A project that queues three runs waits behind whatever was already there.
 */
export class AdmissionQueue {
  private readonly entries: QueueEntry[] = [];

  get length(): number {
    return this.entries.length;
  }

  list(): QueueEntry[] {
    return [...this.entries];
  }

  /**
   * Add an entry, or return where an identical one already sits. Re-asking for
   * a task that is already queued must not move it, nor queue it twice — a
   * double-clicked button is the common case.
   *
   * @returns 1-based position in the queue.
   */
  enqueue(entry: QueueEntry): { position: number; added: boolean } {
    const existing = this.entries.findIndex((e) => sameQueueEntry(e, entry));
    if (existing !== -1) return { position: existing + 1, added: false };
    this.entries.push(entry);
    return { position: this.entries.length, added: true };
  }

  /** Remove and return the entry at the head, or null when empty. */
  shift(): QueueEntry | null {
    return this.entries.shift() ?? null;
  }

  /** Put an entry back at the head — its turn came but the start failed. */
  unshift(entry: QueueEntry): void {
    this.entries.unshift(entry);
  }

  /** Drop every entry for a project that is no longer registered. */
  dropProject(projectId: string): number {
    let removed = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].projectId === projectId) {
        this.entries.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  /** 1-based position of a matching entry, or 0 when it is not queued. */
  positionOf(entry: Pick<QueueEntry, "projectId" | "workspace" | "taskId">): number {
    return this.entries.findIndex((e) => sameQueueEntry(e, entry)) + 1;
  }
}

export interface AdmissionGateOptions {
  limits: AdmissionLimits;
  /** Dashboard-started runs in flight across every child. */
  countRunning: () => Promise<number>;
  /** Start a queued run on its project's server. False means it did not take. */
  start: (entry: QueueEntry) => Promise<boolean>;
  /** Injectable for tests; defaults to `os.freemem()`. */
  freeMemory?: () => number;
  /** How often to retry while anything is queued. Default 2 s. */
  drainIntervalMs?: number;
  /** Called after every change, for anything reporting queue state. */
  onChange?: (snapshot: QueueSnapshot) => void;
  log?: (message: string) => void;
}

export interface AdmitResult {
  admitted: boolean;
  /** 1-based queue position when it was not admitted. */
  position: number;
  reason?: AdmissionReason;
}

/**
 * The gate itself: measure, decide, and hold what cannot start yet.
 */
export class AdmissionGate {
  readonly queue = new AdmissionQueue();
  private readonly options: AdmissionGateOptions;
  private readonly freeMemory: () => number;
  private readonly drainIntervalMs: number;
  private readonly log: (message: string) => void;
  private drainTimer: ReturnType<typeof setInterval> | undefined;
  private draining = false;
  private lastSnapshot: AdmissionSnapshot = { running: 0, freeMemoryBytes: 0 };

  constructor(options: AdmissionGateOptions) {
    this.options = options;
    this.freeMemory = options.freeMemory ?? freemem;
    this.drainIntervalMs = options.drainIntervalMs ?? 2_000;
    this.log = options.log ?? (() => {});
  }

  get limits(): AdmissionLimits {
    return this.options.limits;
  }

  /** Measure the machine now. */
  async measure(): Promise<AdmissionSnapshot> {
    const running = await this.options.countRunning().catch(() => 0);
    this.lastSnapshot = { running, freeMemoryBytes: this.freeMemory() };
    return this.lastSnapshot;
  }

  /**
   * Admit a request or queue it.
   *
   * A request is queued behind anything already waiting even when there is
   * room for it: letting a late arrival overtake the queue because a slot
   * happened to open is how a queue stops meaning anything.
   */
  async admit(request: Omit<QueueEntry, "enqueuedAt">): Promise<AdmitResult> {
    const snapshot = await this.measure();
    const decision = decideAdmission(snapshot, this.options.limits);

    if (decision.admit && this.queue.length === 0) {
      return { admitted: true, position: 0 };
    }

    const reason = decision.admit ? "at-capacity" : decision.reason;
    const { position } = this.queue.enqueue({ ...request, enqueuedAt: new Date().toISOString() });
    this.armDrain();
    this.emitChange();
    return { admitted: false, position, reason };
  }

  /**
   * Release as many queued entries as the machine now has room for.
   *
   * Re-measures between starts: two entries released against one free slot is
   * exactly the overload the gate exists to prevent.
   */
  async drain(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    let released = 0;
    try {
      for (;;) {
        if (this.queue.length === 0) break;
        const snapshot = await this.measure();
        if (!decideAdmission(snapshot, this.options.limits).admit) break;

        const entry = this.queue.shift()!;
        let started = false;
        try {
          started = await this.options.start(entry);
        } catch (err) {
          this.log(`[hub] admission: starting ${entry.taskId} failed — ${(err as Error).message}`);
        }
        if (!started) {
          // Its project may have gone; drop it rather than spin on it forever.
          this.log(`[hub] admission: dropped queued ${entry.projectId}/${entry.taskId} — its server did not accept it`);
        } else {
          released++;
        }
        this.emitChange();
      }
    } finally {
      this.draining = false;
      if (this.queue.length === 0) this.disarmDrain();
    }
    return released;
  }

  /** Forget everything queued for a project the hub no longer serves. */
  forgetProject(projectId: string): void {
    if (this.queue.dropProject(projectId) > 0) this.emitChange();
    if (this.queue.length === 0) this.disarmDrain();
  }

  snapshot(): QueueSnapshot {
    const decision = decideAdmission(this.lastSnapshot, this.options.limits);
    return {
      entries: this.queue.list(),
      running: this.lastSnapshot.running,
      freeMemoryBytes: this.lastSnapshot.freeMemoryBytes,
      limits: this.options.limits,
      memoryPaused: !decision.admit && decision.reason === "low-memory",
    };
  }

  /** Stop the drain timer. The hub calls this on close. */
  stop(): void {
    this.disarmDrain();
  }

  private emitChange(): void {
    this.options.onChange?.(this.snapshot());
  }

  private armDrain(): void {
    if (this.drainTimer !== undefined) return;
    this.drainTimer = setInterval(() => {
      void this.drain();
    }, this.drainIntervalMs);
    this.drainTimer.unref?.();
  }

  private disarmDrain(): void {
    if (this.drainTimer === undefined) return;
    clearInterval(this.drainTimer);
    this.drainTimer = undefined;
  }
}

/** One child's in-flight dashboard executions. Unreachable children count zero. */
export async function countProjectExecutions(port: number, timeoutMs = 2_000): Promise<number> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return 0;
    const body = (await res.json()) as { executions?: Array<{ status?: unknown }> };
    if (!Array.isArray(body.executions)) return 0;
    // "starting" counts: the process is spawned and holding memory well before
    // it reports running.
    return body.executions.filter((e) => e.status === "starting" || e.status === "running").length;
  } catch {
    return 0;
  }
}
