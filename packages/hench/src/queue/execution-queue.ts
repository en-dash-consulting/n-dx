/**
 * Execution queue for hench task runs.
 *
 * When the configured concurrency limit is reached, new task execution
 * requests are held in a FIFO queue with optional priority override.
 * Higher-priority tasks are inserted ahead of lower-priority ones.
 *
 * The queue is designed for in-process use: a single ExecutionQueue
 * instance manages concurrency within one hench process (e.g. loop
 * mode, epic-by-epic, or the web dashboard's task runner).
 *
 * @module hench/queue/execution-queue
 */

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

/**
 * Task priority levels, ordered from highest to lowest.
 * Used for priority-based insertion into the FIFO queue.
 */
export type TaskPriority = "critical" | "high" | "medium" | "low";

const PRIORITY_RANK: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Normalize a string to a known priority, defaulting to "medium". */
export function normalizePriority(value?: string): TaskPriority {
  if (value && value in PRIORITY_RANK) return value as TaskPriority;
  return "medium";
}

// ---------------------------------------------------------------------------
// Queue entry types
// ---------------------------------------------------------------------------

/** A task waiting in the execution queue. */
export interface QueueEntry {
  /** Task ID from the PRD. */
  taskId: string;
  /** Resolved priority for queue ordering. */
  priority: TaskPriority;
  /** ISO timestamp when the task was enqueued. */
  enqueuedAt: string;
}

/** Snapshot of queue state, suitable for API/CLI display. */
export interface QueueStatus {
  /** Maximum concurrent task executions allowed. */
  maxConcurrent: number;
  /** Number of tasks currently executing. */
  activeCount: number;
  /** Number of tasks waiting in the queue. */
  queuedCount: number;
  /** Whether the queue is accepting new tasks. */
  accepting: boolean;
  /** Ordered list of queued tasks (first = next to run). */
  queued: Array<QueueEntry & { position: number }>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PendingSlot {
  taskId: string;
  priority: TaskPriority;
  enqueuedAt: string;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

// ---------------------------------------------------------------------------
// ExecutionQueue
// ---------------------------------------------------------------------------

/**
 * Bounded execution queue with FIFO scheduling and priority override.
 *
 * Callers {@link acquire} a slot before starting a task run and
 * {@link release} it when the run completes (regardless of outcome).
 * If the queue is full, `acquire` returns a Promise that resolves
 * when a slot becomes available.
 *
 * @example
 * ```ts
 * const queue = new ExecutionQueue(3);
 *
 * await queue.acquire("task-123", "high");
 * try {
 *   await runOne(/* ... *\/);
 * } finally {
 *   queue.release();
 * }
 *
 * console.log(queue.status());
 * ```
 */
export class ExecutionQueue {
  private readonly _maxConcurrent: number;
  private _activeCount = 0;
  private _queue: PendingSlot[] = [];
  private _draining = false;

  constructor(maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new RangeError("ExecutionQueue maxConcurrent must be >= 1");
    }
    this._maxConcurrent = maxConcurrent;
  }

  // -----------------------------------------------------------------------
  // Public getters
  // -----------------------------------------------------------------------

  /** Maximum concurrent task executions allowed. */
  get maxConcurrent(): number {
    return this._maxConcurrent;
  }

  /** Number of tasks currently executing. */
  get active(): number {
    return this._activeCount;
  }

  /** Number of tasks waiting in the queue. */
  get pending(): number {
    return this._queue.length;
  }

  /** Whether the queue is accepting new task requests. */
  get accepting(): boolean {
    return !this._draining;
  }

  // -----------------------------------------------------------------------
  // acquire / release
  // -----------------------------------------------------------------------

  /**
   * Acquire an execution slot for a task.
   *
   * If a slot is available, resolves immediately. Otherwise the task
   * is queued in FIFO order with priority override: tasks with a
   * higher priority (lower rank) are inserted before tasks with a
   * lower priority.
   *
   * @param taskId  PRD task identifier (for status display).
   * @param priority  Task priority string (defaults to "medium").
   * @returns Promise that resolves when a slot is available.
   * @throws {Error} If the queue has been drained (shutdown).
   */
  acquire(taskId: string, priority?: string): Promise<void> {
    if (this._draining) {
      return Promise.reject(new Error("ExecutionQueue is draining; not accepting new tasks"));
    }

    // Slot available — grant immediately
    if (this._activeCount < this._maxConcurrent) {
      this._activeCount++;
      return Promise.resolve();
    }

    // Queue the request
    const resolved = normalizePriority(priority);
    return new Promise<void>((resolve, reject) => {
      const entry: PendingSlot = {
        taskId,
        priority: resolved,
        enqueuedAt: new Date().toISOString(),
        resolve,
        reject,
      };
      this._insertByPriority(entry);
    });
  }

  /**
   * Release an execution slot after a task run completes.
   *
   * If there are queued tasks, the next one is dequeued and its
   * `acquire` promise is resolved so execution can begin.
   *
   * Must be called exactly once per successful `acquire`.
   */
  release(): void {
    if (this._activeCount <= 0) {
      throw new Error("ExecutionQueue.release() called with no active slots");
    }

    // If there are queued tasks, hand the slot directly to the next one
    if (this._queue.length > 0) {
      const next = this._queue.shift()!;
      // activeCount stays the same — slot transfers to the next task
      next.resolve();
    } else {
      this._activeCount--;
    }
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  /**
   * Return a snapshot of the current queue state.
   *
   * The returned object is a plain data structure (no functions or
   * promises) suitable for JSON serialization and display.
   */
  status(): QueueStatus {
    return {
      maxConcurrent: this._maxConcurrent,
      activeCount: this._activeCount,
      queuedCount: this._queue.length,
      accepting: !this._draining,
      queued: this._queue.map((entry, idx) => ({
        taskId: entry.taskId,
        priority: entry.priority,
        enqueuedAt: entry.enqueuedAt,
        position: idx + 1,
      })),
    };
  }

  // -----------------------------------------------------------------------
  // Drain (graceful shutdown)
  // -----------------------------------------------------------------------

  /**
   * Drain the queue: reject all pending tasks and prevent new ones.
   *
   * Active tasks are not interrupted — they continue to completion.
   * Only queued (waiting) tasks are rejected with a descriptive error.
   *
   * Call this on SIGINT / SIGTERM to clean up gracefully.
   */
  drain(): void {
    this._draining = true;
    const pending = this._queue.splice(0);
    for (const entry of pending) {
      entry.reject(new Error("ExecutionQueue drained: task cancelled before execution"));
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Insert a queued entry in priority order.
   *
   * Within the same priority level, entries are appended (FIFO).
   * Entries with a higher priority (lower rank number) are inserted
   * before entries with a lower priority (higher rank number).
   */
  private _insertByPriority(entry: PendingSlot): void {
    const rank = PRIORITY_RANK[entry.priority];

    // Find the first position where the existing entry has a strictly
    // lower priority (higher rank number) than the new entry.
    let insertIdx = this._queue.length; // default: append at end
    for (let i = 0; i < this._queue.length; i++) {
      if (PRIORITY_RANK[this._queue[i].priority] > rank) {
        insertIdx = i;
        break;
      }
    }

    this._queue.splice(insertIdx, 0, entry);
  }
}
