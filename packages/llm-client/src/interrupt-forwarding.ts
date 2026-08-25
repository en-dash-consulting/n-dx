/**
 * Relay the terminal's interrupt to children that were detached out of reach.
 *
 * Ctrl-C is delivered by the terminal to its foreground process GROUP, not to a
 * process. {@link treeKillSpawnOptions} deliberately puts POSIX children in a
 * group of their own — that is what lets a timeout `kill(-pgid)` reach
 * grandchildren — and the cost is that the terminal's interrupt no longer
 * reaches them. A long-running command run through {@link exec} (hench's
 * `run_command` and `git` tools are the ones users meet) could then only be
 * stopped by killing the tree by hand.
 *
 * So the parent forwards: while a detached child is alive, a SIGINT arriving at
 * this process is passed on to each child's group, restoring what the terminal
 * would have done by itself.
 *
 * ## Why this does not just install a handler and stop there
 *
 * Attaching ANY listener to SIGINT suppresses the runtime's default action —
 * terminate. A forwarder that only forwards therefore turns every CLI it is
 * loaded into one that ignores Ctrl-C, which is a worse bug than the one it set
 * out to fix. Two rules follow, and both are asserted in the unit tests:
 *
 * - The listener exists only while a detached child does. No child, no listener,
 *   no suppression.
 * - If nothing else is listening when the interrupt lands, the suppression is
 *   ours alone: stand down and re-raise, so the default action runs after all.
 *   If something else IS listening (hench's run-loop, core's `cli.js`), the
 *   parent's fate is already owned and must be left alone.
 *
 * Scope is SIGINT — the interactive interrupt this exists to restore. Detached
 * children spawned to OUTLIVE the parent (`spawnTool`'s fire-and-forget mode,
 * e.g. `ndx start --background`) never register here: killing the background
 * server on Ctrl-C is exactly what that mode is built to avoid.
 *
 * @module @n-dx/llm-client/interrupt-forwarding
 */

/**
 * The slice of `process` this needs.
 *
 * Injected so the sole-listener case is testable: exercised against the real
 * `process`, it would re-raise SIGINT and kill the test runner.
 */
export interface InterruptHost {
  readonly pid: number;
  on(signal: "SIGINT", listener: () => void): void;
  removeListener(signal: "SIGINT", listener: () => void): void;
  /**
   * The listeners themselves, not a count: "is anyone ELSE listening" has to be
   * answered by identity. A count forces the assumption that this forwarder
   * appears exactly once, and hench's prompt shim
   * (`agent/lifecycle/shared.ts`) snapshots every SIGINT listener and re-adds
   * them afterwards — which can leave a second copy of ours registered. Counting
   * would then read our own duplicate as somebody else's handler and skip the
   * re-raise, putting back the ignored-Ctrl-C bug this module exists to prevent.
   */
  listeners(signal: "SIGINT"): Array<(...args: never[]) => void>;
  kill(pid: number, signal: NodeJS.Signals): void;
}

export interface InterruptForwarderOptions {
  /** Defaults to the real process. */
  host?: InterruptHost;
}

/**
 * Whether a child spawned with these options needs its interrupts forwarded.
 *
 * Takes the options that were actually passed to `spawn` rather than consulting
 * the platform a second time: the gap being bridged is `detached`, so reading
 * `detached` keeps this decision and {@link treeKillSpawnOptions} from drifting
 * apart. A non-detached child shares the parent's group and already gets the
 * terminal's Ctrl-C.
 */
export function forwardsInterrupts(spawnOptions: { detached?: boolean }): boolean {
  return spawnOptions.detached === true;
}

/**
 * Forwards SIGINT to the groups of every registered child, with one listener
 * shared across all of them.
 *
 * One listener rather than one per child: an agent run issues far more than the
 * ten commands Node warns at, and each is its own `exec` call.
 */
export class InterruptForwarder {
  private readonly host: InterruptHost;
  private readonly groupLeaders = new Set<number>();

  constructor({ host = process }: InterruptForwarderOptions = {}) {
    this.host = host;
  }

  /**
   * Forward interrupts to `groupLeaderPid`'s group until the returned release is
   * called. Release is idempotent — `exec` settles from several paths.
   */
  register(groupLeaderPid: number): () => void {
    this.groupLeaders.add(groupLeaderPid);
    // Asking the host rather than tracking a flag: a listener re-added behind our
    // back (see {@link InterruptHost.listeners}) is installed whether or not this
    // object knows it, and a second copy would double every forward.
    if (!this.isInstalled()) this.host.on("SIGINT", this.onInterrupt);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.groupLeaders.delete(groupLeaderPid);
      if (this.groupLeaders.size === 0) this.standDown();
    };
  }

  private readonly onInterrupt = (): void => {
    for (const pid of [...this.groupLeaders]) {
      try {
        // Negative pid is the group: the child plus everything it started.
        this.host.kill(-pid, "SIGINT");
      } catch {
        // Group already gone — a normal race between exit and Ctrl-C, and no
        // reason to skip the children that are still alive.
      }
    }

    // Anyone else listening owns what happens to this process — hench's run-loop
    // and core's cli.js both install SIGINT handlers for graceful cancellation,
    // and re-raising would pre-empt them.
    const foreign = this.host.listeners("SIGINT").some((l) => l !== this.onInterrupt);
    if (foreign) return;

    this.standDown();
    try {
      this.host.kill(this.host.pid, "SIGINT");
    } catch {
      // Nothing left to try; the caller sees the interrupt through the child.
    }
  };

  private isInstalled(): boolean {
    return this.host.listeners("SIGINT").includes(this.onInterrupt);
  }

  /**
   * Remove every copy of our listener — `removeListener` drops one occurrence,
   * and leaving a duplicate behind would keep suppressing the default SIGINT
   * action after the last child is gone.
   */
  private standDown(): void {
    while (this.isInstalled()) this.host.removeListener("SIGINT", this.onInterrupt);
  }
}

/**
 * The forwarder {@link exec} registers with — process-wide, because the listener
 * budget it is rationing is process-wide.
 */
export const processInterruptForwarder = new InterruptForwarder();
