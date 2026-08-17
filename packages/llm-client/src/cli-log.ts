/**
 * Append-only invocation log for vendor CLI spawns (`claude`, `codex`, …).
 *
 * Every real vendor-CLI invocation is recorded as one JSON line so a project
 * accumulates a consistent, cross-session history of what was actually run.
 * This is deliberately NOT the `.args` files written by e2e fake-CLI fixtures —
 * those are per-test scratch files that truncate on every call.
 *
 * TWIN: mirrored in `packages/core/cli-log.js`. The orchestration tier must not
 * import @n-dx/llm-client (spawn-only rule, enforced by domain-isolation.test.js),
 * so core carries its own copy. Any behavioural change here MUST be mirrored
 * there — `tests/unit/cli-log-parity.test.js` fails if the two diverge.
 *
 * Design constraints:
 * - **Never throws.** Logging must not break a spawn. Every filesystem call is
 *   wrapped; failures are swallowed.
 * - **One atomic append per invocation.** A single `appendFileSync` of one line
 *   is atomic enough on both POSIX and Windows that concurrent `ndx` processes
 *   interleave cleanly by line. Multi-line records would tear.
 * - **Secrets redacted.** argv can carry API keys; see {@link redactArgs}.
 */

import { appendFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/** Rotate once the log passes this size, mirroring `.rex/execution-log.jsonl`. */
export const CLI_LOG_MAX_BYTES = 1_048_576;

/** Default log filename, resolved against the n-dx process cwd. */
export const CLI_LOG_FILENAME = "claude_commands.log";

/**
 * Whether invocation logging is enabled. Enabled by default — opt out with
 * `NDX_CLI_LOG=0` (also accepts `false` / `no`).
 */
export function isCliLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.NDX_CLI_LOG;
  return !(v === "0" || v === "false" || v === "no");
}

/**
 * Resolve the log file path. `NDX_CLI_LOG_PATH` wins; otherwise the file sits
 * at the root of the current working directory (the project root for every
 * normal `ndx` invocation).
 */
export function resolveCliLogPath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return env.NDX_CLI_LOG_PATH || join(cwd, CLI_LOG_FILENAME);
}

/** Argv tokens whose FOLLOWING value is a secret and must not be logged. */
const SECRET_FLAGS = new Set(["--api-key", "--apikey", "--token", "--auth-token", "--password"]);

/** Token shapes that are secrets on their own, wherever they appear. */
const SECRET_PATTERNS = [
  /^sk-ant-\S+/i,
  /^sk-[A-Za-z0-9_-]{16,}/i,
  /^gh[pousr]_[A-Za-z0-9]{16,}/,
  /^AIza[A-Za-z0-9_-]{20,}/,
];

/**
 * Replace secret-bearing argv entries with `<redacted>`.
 *
 * argv reaching a vendor CLI can carry credentials, and this log is a plain
 * file that outlives the process — so redaction happens before the write, not
 * at read time.
 */
export function redactArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  let redactNext = false;

  for (const arg of args) {
    if (redactNext) {
      out.push("<redacted>");
      redactNext = false;
      continue;
    }

    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);

    if (SECRET_FLAGS.has(flag.toLowerCase())) {
      if (eq === -1) {
        out.push(arg);
        redactNext = true;
      } else {
        out.push(`${flag}=<redacted>`);
      }
      continue;
    }

    out.push(SECRET_PATTERNS.some((re) => re.test(arg)) ? "<redacted>" : arg);
  }

  return out;
}

/** Derive a coarse vendor label from a binary path or bare command name. */
export function vendorFromBinary(binary: string): string {
  const base = binary.replace(/\\/g, "/").split("/").pop() ?? binary;
  const stem = base.replace(/\.(cmd|bat|exe|ps1)$/i, "").toLowerCase();
  if (stem.includes("claude")) return "claude";
  if (stem.includes("codex")) return "codex";
  return stem || "unknown";
}

/** Rotate the log when it exceeds {@link CLI_LOG_MAX_BYTES}. Never throws. */
function rotateIfNeeded(path: string): void {
  try {
    if (statSync(path).size <= CLI_LOG_MAX_BYTES) return;
    renameSync(path, `${path}.1`);
  } catch {
    // Missing file (nothing to rotate) or a concurrent rotation — either is fine.
  }
}

export interface CliInvocationRecord {
  /** Binary as requested by the caller (bare name or absolute path). */
  binary: string;
  /** Argument vector, pre-redaction. */
  args: readonly string[];
  /** Working directory the child was given, if any. */
  cwd?: string;
  /** Which helper performed the spawn, e.g. `spawnCli` / `execFileSyncCli`. */
  via?: string;
  /** Platform the spawn was built for. Defaults to the running platform. */
  platform?: string;
  /** Fully-built Windows verbatim command line, when one was constructed. */
  commandLine?: string;
}

/**
 * Serialize one invocation record to a single JSONL line.
 *
 * Exported for the cross-package parity test — the timestamp is injected so
 * the function stays pure and testable.
 */
export function formatCliLogLine(record: CliInvocationRecord, timestamp: string): string {
  const entry: Record<string, unknown> = {
    ts: timestamp,
    vendor: vendorFromBinary(record.binary),
    binary: record.binary,
    args: redactArgs(record.args),
    platform: record.platform ?? process.platform,
  };
  if (record.cwd) entry.cwd = record.cwd;
  if (record.via) entry.via = record.via;
  if (record.commandLine) entry.commandLine = record.commandLine;
  return `${JSON.stringify(entry)}\n`;
}

/**
 * Record a vendor-CLI invocation. Best-effort and non-throwing: a logging
 * failure must never surface as a spawn failure.
 */
export function logCliInvocation(record: CliInvocationRecord, env: NodeJS.ProcessEnv = process.env): void {
  if (!isCliLogEnabled(env)) return;

  try {
    const path = resolveCliLogPath(env);
    rotateIfNeeded(path);
    appendFileSync(path, formatCliLogLine(record, new Date().toISOString()), "utf-8");
  } catch {
    // Read-only cwd, permission denied, disk full — logging is never fatal.
  }
}
