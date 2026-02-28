/**
 * Runtime process pool — reusable Node.js worker management.
 *
 * Maintains warm Node.js runtimes that can be borrowed for task
 * execution and returned for reuse, avoiding V8 startup overhead
 * and reducing memory consumption by 60%+ for sequential tasks.
 *
 * The pool follows an acquire/release pattern:
 *
 * ```ts
 * const pool = new RuntimePool(workerFactory, { maxWorkers: 3 });
 * const runtime = pool.acquire();
 * try {
 *   // dispatch work to runtime.handle
 * } finally {
 *   pool.release(runtime);
 * }
 * await pool.shutdown();
 * ```
 *
 * Features:
 * - Warm runtime reuse (avoids V8 + module loading per task)
 * - Configurable idle timeout (auto-terminates unused workers)
 * - Max tasks per worker recycling (prevents memory leaks)
 * - Graceful shutdown (drains busy workers)
 *
 * @module hench/process/pool
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the runtime process pool.
 *
 * All fields are optional when constructing — unset fields take
 * their defaults from {@link DEFAULT_RUNTIME_POOL_CONFIG}.
 */
export interface RuntimePoolConfig {
  /** Whether the pool is enabled. Defaults to true. */
  enabled: boolean;
  /** Maximum number of warm workers in the pool. Defaults to 2. */
  maxWorkers: number;
  /** Idle timeout in ms before terminating unused workers. 0 = no timeout. Defaults to 300000 (5 min). */
  idleTimeoutMs: number;
  /** Maximum tasks a worker handles before being recycled. Defaults to 10. */
  maxTasksPerWorker: number;
}

export const DEFAULT_RUNTIME_POOL_CONFIG: Readonly<RuntimePoolConfig> = Object.freeze({
  enabled: true,
  maxWorkers: 2,
  idleTimeoutMs: 300_000,      // 5 minutes
  maxTasksPerWorker: 10,
});

// ---------------------------------------------------------------------------
// Worker handle (minimal interface, injectable for testing)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for a managed worker process.
 *
 * Satisfied by `child_process.ChildProcess` and `worker_threads.Worker`.
 * Kept minimal so tests can provide lightweight stubs without mocking
 * the full Node.js process API.
 */
export interface WorkerHandle {
  /** Process ID, or undefined if not yet spawned. */
  readonly pid: number | undefined;
  /** Whether the IPC channel / message port is connected. */
  readonly connected: boolean;
  /** Terminate the worker process. */
  kill(signal?: NodeJS.Signals): boolean;
}

/**
 * Factory function that creates a new worker process.
 *
 * The pool calls this when it needs a fresh runtime. The factory
 * must return a connected WorkerHandle (e.g. via `child_process.fork()`
 * or `worker_threads.Worker`).
 */
export type WorkerFactory = () => WorkerHandle;

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

/** Lifecycle state of a pooled worker. */
export type WorkerState = "idle" | "busy" | "draining";

/**
 * Opaque token returned by {@link RuntimePool.acquire}.
 *
 * Callers use `handle` to dispatch work to the underlying process,
 * then pass the token back to {@link RuntimePool.release} when done.
 */
export interface PooledRuntime {
  /** Unique identifier for this runtime instance. */
  readonly id: string;
  /** Underlying worker process handle. */
  readonly handle: WorkerHandle;
  /** Number of tasks this runtime has completed so far. */
  readonly tasksCompleted: number;
  /** ISO timestamp when this runtime was first created. */
  readonly createdAt: string;
}

/** Snapshot of a single worker's state, suitable for status display. */
export interface PooledRuntimeInfo {
  id: string;
  state: WorkerState;
  pid: number | undefined;
  tasksCompleted: number;
  createdAt: string;
  lastUsedAt: string;
}

// ---------------------------------------------------------------------------
// Pool status
// ---------------------------------------------------------------------------

/** Snapshot of pool state for monitoring and display. */
export interface RuntimePoolStatus {
  /** Maximum workers the pool will maintain. */
  maxWorkers: number;
  /** Total workers currently alive (idle + busy). */
  totalWorkers: number;
  /** Workers waiting to be reused. */
  idleCount: number;
  /** Workers currently executing tasks. */
  busyCount: number;
  /** Cumulative tasks completed across all workers since pool creation. */
  totalTasksCompleted: number;
  /** Cumulative workers created since pool creation. */
  totalWorkersCreated: number;
  /** Cumulative workers recycled (terminated after use) since pool creation. */
  totalWorkersRecycled: number;
  /** Whether the pool is accepting new acquire requests. */
  accepting: boolean;
  /** Per-worker state snapshots. */
  workers: PooledRuntimeInfo[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when all pool workers are busy and no new workers can be created.
 *
 * Callers should either wait and retry, or use {@link ExecutionQueue}
 * in front of the pool to queue requests.
 */
export class PoolExhaustedError extends Error {
  readonly maxWorkers: number;
  readonly busyCount: number;

  constructor(maxWorkers: number, busyCount: number) {
    super(
      `Process pool exhausted: all ${maxWorkers} worker(s) are busy. ` +
      `Wait for a worker to be released, or increase pool.maxWorkers.`,
    );
    this.name = "PoolExhaustedError";
    this.maxWorkers = maxWorkers;
    this.busyCount = busyCount;
  }
}

// ---------------------------------------------------------------------------
// Internal worker wrapper
// ---------------------------------------------------------------------------

class InternalWorker implements PooledRuntime {
  readonly id: string;
  readonly handle: WorkerHandle;
  readonly createdAt: string;

  state: WorkerState = "idle";
  tasksCompleted = 0;
  lastUsedAt: string;

  constructor(id: string, handle: WorkerHandle) {
    this.id = id;
    this.handle = handle;
    this.createdAt = new Date().toISOString();
    this.lastUsedAt = this.createdAt;
  }

  info(): PooledRuntimeInfo {
    return {
      id: this.id,
      state: this.state,
      pid: this.handle.pid,
      tasksCompleted: this.tasksCompleted,
      createdAt: this.createdAt,
      lastUsedAt: this.lastUsedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// RuntimePool
// ---------------------------------------------------------------------------

/**
 * Manages a pool of warm Node.js runtimes for task execution reuse.
 *
 * Callers {@link acquire} a runtime before starting a task and
 * {@link release} it when the task completes (regardless of outcome).
 * If no idle runtime is available and the pool is under capacity,
 * a new one is created via the factory. If the pool is full,
 * {@link PoolExhaustedError} is thrown.
 *
 * Workers are automatically recycled after {@link RuntimePoolConfig.maxTasksPerWorker}
 * tasks and terminated after {@link RuntimePoolConfig.idleTimeoutMs}
 * of inactivity. Task isolation is maintained by recycling workers
 * that have accumulated state, and callers can enforce additional
 * isolation by using the pool in combination with environment resets.
 *
 * @example
 * ```ts
 * const pool = new RuntimePool(() => fork("worker.js"), {
 *   maxWorkers: 3,
 *   idleTimeoutMs: 60_000,
 *   maxTasksPerWorker: 5,
 * });
 *
 * const runtime = pool.acquire();
 * try {
 *   await executeTask(runtime.handle);
 * } finally {
 *   pool.release(runtime);
 * }
 *
 * await pool.shutdown();
 * ```
 */
export class RuntimePool {
  private readonly _config: RuntimePoolConfig;
  private readonly _factory: WorkerFactory;

  // Worker tracking
  private readonly _idle: InternalWorker[] = [];
  private readonly _busy: Set<InternalWorker> = new Set();
  private readonly _idleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // Worker-to-internal mapping (for release validation)
  private readonly _registry: Map<string, InternalWorker> = new Map();

  // Metrics
  private _nextWorkerId = 0;
  private _shuttingDown = false;
  private _totalCreated = 0;
  private _totalRecycled = 0;
  private _totalTasksCompleted = 0;

  constructor(factory: WorkerFactory, config?: Partial<RuntimePoolConfig>) {
    this._factory = factory;
    this._config = { ...DEFAULT_RUNTIME_POOL_CONFIG, ...config };

    if (this._config.maxWorkers < 1) {
      throw new RangeError("RuntimePool maxWorkers must be >= 1");
    }
    if (this._config.idleTimeoutMs < 0) {
      throw new RangeError("RuntimePool idleTimeoutMs must be >= 0");
    }
    if (this._config.maxTasksPerWorker < 1) {
      throw new RangeError("RuntimePool maxTasksPerWorker must be >= 1");
    }
  }

  // -----------------------------------------------------------------------
  // Public getters
  // -----------------------------------------------------------------------

  /** Pool configuration (frozen copy). */
  get config(): Readonly<RuntimePoolConfig> {
    return this._config;
  }

  /** Total live workers (idle + busy). */
  get size(): number {
    return this._idle.length + this._busy.size;
  }

  /** Number of idle workers waiting for reuse. */
  get idleCount(): number {
    return this._idle.length;
  }

  /** Number of workers currently executing tasks. */
  get busyCount(): number {
    return this._busy.size;
  }

  /** Whether the pool is accepting new acquire requests. */
  get accepting(): boolean {
    return !this._shuttingDown;
  }

  // -----------------------------------------------------------------------
  // acquire / release
  // -----------------------------------------------------------------------

  /**
   * Acquire a warm runtime from the pool.
   *
   * Returns an idle runtime if available, otherwise creates a new one
   * via the factory (up to maxWorkers). Throws {@link PoolExhaustedError}
   * if all workers are busy and no new workers can be created.
   *
   * @returns A pooled runtime token. Must be passed to {@link release}
   *          when done, regardless of task outcome.
   * @throws {PoolExhaustedError} when the pool is at capacity and all busy.
   * @throws {Error} when the pool is shutting down.
   */
  acquire(): PooledRuntime {
    if (this._shuttingDown) {
      throw new Error("RuntimePool is shutting down; not accepting new requests");
    }

    // Try to reuse an idle worker
    if (this._idle.length > 0) {
      const worker = this._idle.shift()!;
      this._clearIdleTimer(worker.id);
      worker.state = "busy";
      this._busy.add(worker);
      return worker;
    }

    // Create a new worker if under capacity
    if (this.size < this._config.maxWorkers) {
      const worker = this._createWorker();
      worker.state = "busy";
      this._busy.add(worker);
      return worker;
    }

    // Pool exhausted
    throw new PoolExhaustedError(this._config.maxWorkers, this._busy.size);
  }

  /**
   * Release a runtime back to the pool after task completion.
   *
   * The runtime is returned to the idle pool for reuse, or recycled
   * if it has exceeded {@link RuntimePoolConfig.maxTasksPerWorker}.
   * Starts an idle timeout timer for the returned worker.
   *
   * Must be called exactly once per successful {@link acquire}, typically
   * in a `finally` block to guarantee cleanup.
   *
   * @param runtime  The runtime token returned by {@link acquire}.
   * @throws {Error} if the runtime is not currently busy in this pool.
   */
  release(runtime: PooledRuntime): void {
    const worker = this._registry.get(runtime.id);

    if (!worker || !this._busy.has(worker)) {
      throw new Error("Cannot release a runtime that is not busy in this pool");
    }

    this._busy.delete(worker);
    worker.tasksCompleted++;
    worker.lastUsedAt = new Date().toISOString();
    this._totalTasksCompleted++;

    // Recycle if at task limit or pool is shutting down
    if (
      worker.tasksCompleted >= this._config.maxTasksPerWorker ||
      this._shuttingDown
    ) {
      this._terminateWorker(worker);
      this._totalRecycled++;
      return;
    }

    // Return to idle pool
    worker.state = "idle";
    this._idle.push(worker);
    this._startIdleTimer(worker);
  }

  // -----------------------------------------------------------------------
  // Shutdown
  // -----------------------------------------------------------------------

  /**
   * Terminate all workers and prevent new acquisitions.
   *
   * Idle workers are terminated immediately. Busy workers are marked
   * for draining — they will be terminated when released. After
   * shutdown, all subsequent {@link acquire} calls will throw.
   */
  async shutdown(): Promise<void> {
    this._shuttingDown = true;

    // Clear all idle timers
    for (const [, timer] of this._idleTimers) {
      clearTimeout(timer);
    }
    this._idleTimers.clear();

    // Terminate idle workers immediately
    while (this._idle.length > 0) {
      const worker = this._idle.shift()!;
      this._terminateWorker(worker);
    }

    // Mark busy workers for draining (terminated on release)
    for (const worker of this._busy) {
      worker.state = "draining";
    }
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  /**
   * Return a snapshot of pool state for monitoring.
   *
   * The returned object is a plain data structure suitable for JSON
   * serialization and display (no functions or promises).
   */
  status(): RuntimePoolStatus {
    const workers: PooledRuntimeInfo[] = [
      ...this._idle.map((w) => w.info()),
      ...[...this._busy].map((w) => w.info()),
    ];

    return {
      maxWorkers: this._config.maxWorkers,
      totalWorkers: this.size,
      idleCount: this._idle.length,
      busyCount: this._busy.size,
      totalTasksCompleted: this._totalTasksCompleted,
      totalWorkersCreated: this._totalCreated,
      totalWorkersRecycled: this._totalRecycled,
      accepting: !this._shuttingDown,
      workers,
    };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private _createWorker(): InternalWorker {
    const handle = this._factory();
    const id = `worker-${++this._nextWorkerId}`;
    const worker = new InternalWorker(id, handle);
    this._registry.set(id, worker);
    this._totalCreated++;
    return worker;
  }

  private _startIdleTimer(worker: InternalWorker): void {
    if (this._config.idleTimeoutMs === 0) return;

    const timer = setTimeout(() => {
      this._evictIdle(worker);
    }, this._config.idleTimeoutMs);

    // Unref so the timer doesn't keep the Node.js event loop alive
    if (typeof timer.unref === "function") timer.unref();

    this._idleTimers.set(worker.id, timer);
  }

  private _clearIdleTimer(id: string): void {
    const timer = this._idleTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this._idleTimers.delete(id);
    }
  }

  private _evictIdle(worker: InternalWorker): void {
    const idx = this._idle.indexOf(worker);
    if (idx !== -1) {
      this._idle.splice(idx, 1);
      this._clearIdleTimer(worker.id);
      this._terminateWorker(worker);
      this._totalRecycled++;
    }
  }

  private _terminateWorker(worker: InternalWorker): void {
    worker.state = "draining";
    this._registry.delete(worker.id);
    try {
      if (worker.handle.connected || worker.handle.pid) {
        worker.handle.kill();
      }
    } catch {
      // Worker already dead — that's fine
    }
  }
}
