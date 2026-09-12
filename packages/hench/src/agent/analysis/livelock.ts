/**
 * Livelock detection — stop a run that keeps making the same tool call.
 *
 * ## The failure this exists to stop (GH #362)
 *
 * Run `f4baa5e6` launched the full test suite as a background task and blocked
 * on it. The machine slept, the suite process died, the agent never noticed,
 * and it repeated one cycle for roughly eighty minutes: relaunch the suite,
 * sleep 90s, block on the dead task, re-read the same unchanged git diff. About
 * a dozen times, ending only because a human interrupted it. It cost sixteen
 * million cache-read tokens.
 *
 * Nothing caught it, and nothing *could*: `lastActivityAt` advances on every
 * tool call and polling is a tool call, so the heartbeat monitor saw maximal
 * activity. An agent that is busy and an agent that is stuck look identical
 * from the outside unless you look at *what* it is busy doing.
 *
 * ## Why this shape, and what was rejected
 *
 * Three designs were on the table.
 *
 * **(A) Repeated-identical-tool-call detection — chosen.** It is the only one
 * that names the defect in the failure message, which is what an operator needs
 * to fix the underlying cause rather than just restart. Its cost is two
 * judgement calls, made explicit below: a threshold, and what counts as "the
 * same call".
 *
 * **(B) A wall-clock cap per task — rejected.** It catches every shape of
 * stall, but any default is wrong for somebody: too low kills a legitimate
 * hour-long migration, too high lets this run burn most of its eighty minutes
 * anyway. It also reports "took too long", which tells an operator nothing
 * about *why*. `hench.maxSpawnsPerTask` and the token budget already bound the
 * blast radius from the other side.
 *
 * **(C) Treating a block on a dead background task as an error — rejected as
 * unimplementable here, and subsumed.** The background task in the failure was
 * Claude Code's own (`Bash(run_in_background)` + `BashOutput`); it lives inside
 * the vendor CLI's tool runtime, which hench spawns but does not host. There is
 * no hench code path that blocks on a background task — grep for `BashOutput`
 * across `packages/` returns nothing. What hench *can* see is the vendor's
 * `tool_use` event stream, and from outside, "blocked on a task whose process is
 * gone" looks exactly like "polls the same id forever, getting the same bytes
 * back". That is (A). So the dead-task case is covered by the detector rather
 * than by a check hench has no standing to make, and the run now fails naming
 * the repeated poll instead of hanging until a human notices.
 *
 * ## The two judgement calls
 *
 * **What is "the same call".** Tool name plus arguments, with object keys
 * ordered so a re-serialised payload is not a different call. When the caller
 * can also observe the *result* — the API loop dispatches tools itself, so it
 * always can — the result joins the signature. That distinction matters for
 * polling: `BashOutput` returning new lines each time is a task making
 * progress, while `BashOutput` returning the same bytes is the livelock. Vendor
 * CLI streams do not reliably carry tool results (Claude's stream-json reports
 * them as `user` messages the adapter does not map), so there the signature is
 * name plus arguments and the threshold carries the weight.
 *
 * Note what "name plus arguments" degrades to on the Codex CLI, where the name
 * carries no information: every command Codex runs arrives as one tool called
 * `shell`, so the name is a constant and identity rests entirely on the
 * arguments — `shell({"command":"pnpm test"})`. Repeats there are repeats of the
 * same *command*, which is the reading we want; but it also means the progress
 * signal cannot arrive as a differently-named edit tool the way it does on
 * Claude. It arrives instead from Codex's `file_change` stream items, which
 * `lifecycle/adapters/codex-cli-adapter.ts` maps to `apply_patch` for exactly
 * this purpose.
 *
 * **When repetition becomes a livelock.** Not adjacency: the observed loop
 * interleaved four different calls per cycle, so a consecutive-identical rule
 * would have seen nothing. Instead, repeats are counted inside a sliding window
 * of recent calls, and *any file-mutating tool call clears the history*. That
 * last rule is what keeps a legitimate fix loop alive: an agent that edits a
 * file between two identical `pnpm test` runs is making progress by definition,
 * however many times it re-runs the suite. An agent that has changed nothing
 * and is on its sixth identical call within forty is not.
 *
 * ## What does not count as progress, and why no heuristic fixes it
 *
 * Only a tool call named in `PROGRESS_TOOLS` clears the history. An edit made by
 * shelling out — `sed -i`, a heredoc, `git apply`, `python - <<EOF` — is
 * invisible on **every** vendor, because it arrives as `Bash`/`shell` carrying a
 * command string, and the only way to tell "wrote a file" from "read one" there
 * is to parse that string.
 *
 * That heuristic is deliberately absent, and should stay absent. It would have
 * to keep pace with every shell idiom that writes, across two vendors' quoting,
 * and each miss is a killed run that *was* making progress. A false stop is the
 * expensive failure here; a missed livelock is not, because
 * `hench.maxSpawnsPerTask` and the token budget still bound it from the other
 * side. The escape hatch for a workflow that genuinely edits through the shell
 * is `hench.livelockThreshold`: raise it, or set it to 0 to disable detection
 * for that project.
 *
 * Pure functions plus one small stateful detector; no I/O. Mirrors the
 * spin.ts / stuck.ts contract.
 *
 * @module hench/agent/analysis/livelock
 */

/**
 * Identical calls within the window before a run is stopped.
 *
 * Six, not three: an agent that checks `git status` after each of five commits
 * is doing normal work, and the cost of a false stop (a killed run, a human
 * restarting it) is higher than the cost of five extra polls. Six identical
 * calls inside forty, with nothing written to disk in between, is not a pattern
 * that appears in a run that is getting anywhere.
 */
export const DEFAULT_LIVELOCK_THRESHOLD = 6;

/**
 * How many recent tool calls the repeat count looks back over.
 *
 * Wide enough to span several iterations of a multi-call cycle (the observed
 * loop was four calls per iteration), narrow enough that six repetitions spread
 * across an hour of otherwise varied work do not accumulate into a false stop.
 */
export const DEFAULT_LIVELOCK_WINDOW = 40;

/** Longest argument/result text that participates in a signature. */
const MAX_SIGNATURE_FIELD = 2000;

/** Argument preview length in the operator-facing message. */
const MAX_MESSAGE_ARGS = 160;

/**
 * Tool names that write to the working tree, in both provider vocabularies —
 * the vendor CLIs' PascalCase tools and hench's own snake_case dispatch names.
 *
 * A call to one of these is the progress signal: the agent has changed the
 * thing it is being asked to change, so whatever it repeated before that is no
 * longer evidence of being stuck.
 *
 * `apply_patch` is load-bearing beyond the Codex CLI's own tool of that name:
 * the Codex adapter synthesises it from `file_change` stream items, which is the
 * only progress signal that vendor produces. Renaming it silently disarms
 * livelock detection for every Codex run.
 */
const PROGRESS_TOOLS: ReadonlySet<string> = new Set([
  // Vendor CLI tools
  "edit",
  "multiedit",
  "write",
  "notebookedit",
  "applypatch",
  "apply_patch",
  // hench API-provider tools
  "write_file",
]);

/** True when a tool call changes files, and so counts as progress. */
export function isProgressTool(tool: string): boolean {
  return PROGRESS_TOOLS.has(tool.toLowerCase());
}

/** One observed tool call. */
export interface LivelockObservation {
  /** Tool name as the provider reports it. */
  tool: string;
  /** Tool arguments, when the caller has them. */
  input?: Record<string, unknown>;
  /**
   * Tool result, when the caller can observe it. Omitted by vendor-CLI callers,
   * which see invocations but not results — see the module header.
   */
  output?: string;
}

/** A confirmed livelock. */
export interface LivelockDetection {
  /** The repeated tool. */
  tool: string;
  /** How many times it repeated inside the window. */
  repeats: number;
  /** Window size in force, for the message and for tests. */
  window: number;
  /** Operator-facing explanation naming the repeated call. */
  message: string;
}

export interface LivelockDetectorOptions {
  /** Repeats before firing. Non-positive disables detection entirely. */
  threshold?: number;
  /** How many recent calls to count over. */
  window?: number;
}

export interface LivelockDetector {
  /**
   * Record a tool call. Returns a detection the first time the threshold is
   * reached, and `null` otherwise — including on later calls of an
   * already-reported signature, so one livelock is reported once.
   */
  record(observation: LivelockObservation): LivelockDetection | null;
  /**
   * The first detection so far, or `null`.
   *
   * Exists so a caller that dispatches tools in a helper (the API loop) can
   * check once per turn instead of threading a return value back out through
   * every executor's signature. Cleared by {@link LivelockDetector.reset}.
   */
  readonly detected: LivelockDetection | null;
  /** Forget all history (a new spawn starts clean). */
  reset(): void;
}

/**
 * Serialise a value with object keys in a stable order.
 *
 * `{a, b}` and `{b, a}` are the same call; a hash over `JSON.stringify` output
 * would disagree because key order follows insertion order, and a vendor that
 * re-serialises its own payload can change that between turns.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
  return `{${entries.join(",")}}`;
}

/** Signature of a call: name + arguments, and the result when it is known. */
function signatureOf(observation: LivelockObservation): string {
  const args = stableStringify(observation.input ?? {}).slice(0, MAX_SIGNATURE_FIELD);
  const result =
    observation.output === undefined ? "" : ` ${observation.output.slice(0, MAX_SIGNATURE_FIELD)}`;
  return `${observation.tool} ${args}${result}`;
}

/** Short, single-line rendering of a call for the failure message. */
function describeCall(observation: LivelockObservation): string {
  const args = observation.input ? stableStringify(observation.input) : "";
  const flat = args.replace(/\s+/g, " ");
  const shown = flat.length > MAX_MESSAGE_ARGS ? `${flat.slice(0, MAX_MESSAGE_ARGS)}…` : flat;
  return `${observation.tool}(${shown})`;
}

/**
 * Create a detector for one agent run.
 *
 * Stateful by necessity — repetition is a property of a sequence — but the
 * state is a bounded ring of signatures, so cost does not grow with run length.
 */
export function createLivelockDetector(opts: LivelockDetectorOptions = {}): LivelockDetector {
  const threshold = opts.threshold ?? DEFAULT_LIVELOCK_THRESHOLD;
  const window = opts.window ?? DEFAULT_LIVELOCK_WINDOW;

  let recent: string[] = [];
  const reported = new Set<string>();
  let firstDetection: LivelockDetection | null = null;

  return {
    get detected(): LivelockDetection | null {
      return firstDetection;
    },

    record(observation: LivelockObservation): LivelockDetection | null {
      if (threshold <= 0) return null;

      if (isProgressTool(observation.tool)) {
        // Files changed — every earlier repetition is now explained.
        recent = [];
        reported.clear();
        firstDetection = null;
        return null;
      }

      const signature = signatureOf(observation);
      recent.push(signature);
      if (recent.length > window) recent = recent.slice(recent.length - window);

      if (reported.has(signature)) return null;

      let repeats = 0;
      for (const entry of recent) {
        if (entry === signature) repeats++;
      }
      if (repeats < threshold) return null;

      reported.add(signature);
      const detection: LivelockDetection = {
        tool: observation.tool,
        repeats,
        window,
        message:
          `Livelock: ${describeCall(observation)} was called ${repeats} times within the last ` +
          `${window} tool calls, with no file written in between. The agent is repeating work ` +
          "rather than making progress, so the run was stopped. Common causes: waiting on a " +
          "background task whose process is gone, re-reading an unchanged diff, or retrying a " +
          "command that fails the same way every time.",
      };
      firstDetection ??= detection;
      return detection;
    },

    reset() {
      recent = [];
      reported.clear();
      firstDetection = null;
    },
  };
}
