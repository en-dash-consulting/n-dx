/**
 * Append-only invocation log for vendor CLI spawns (`claude`, `codex`, …).
 *
 * TWIN: exact behavioural copy of `packages/llm-client/src/cli-log.ts`. The
 * orchestration tier must NOT import @n-dx/llm-client (spawn-only rule,
 * enforced by domain-isolation.test.js), so core carries its own copy — the
 * same reason `quoteWindowsToken` is duplicated into win-spawn.js. Any change
 * here MUST be mirrored there; `tests/unit/cli-log-parity.test.js` fails if the
 * two diverge.
 *
 * See the llm-client copy for the full design rationale. Summary:
 * - Never throws — logging must not break a spawn.
 * - One atomic single-line append per invocation, so concurrent `ndx`
 *   processes interleave cleanly by line.
 * - Secrets in argv are redacted before the write.
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
export function isCliLogEnabled(env = process.env) {
  const v = env.NDX_CLI_LOG;
  return !(v === "0" || v === "false" || v === "no");
}

/**
 * Resolve the log file path. `NDX_CLI_LOG_PATH` wins; otherwise the file sits
 * at the root of the current working directory.
 */
export function resolveCliLogPath(env = process.env, cwd = process.cwd()) {
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

/** Replace secret-bearing argv entries with `<redacted>`. */
export function redactArgs(args) {
  const out = [];
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
export function vendorFromBinary(binary) {
  const base = binary.replace(/\\/g, "/").split("/").pop() ?? binary;
  const stem = base.replace(/\.(cmd|bat|exe|ps1)$/i, "").toLowerCase();
  if (stem.includes("claude")) return "claude";
  if (stem.includes("codex")) return "codex";
  return stem || "unknown";
}

/** Rotate the log when it exceeds {@link CLI_LOG_MAX_BYTES}. Never throws. */
function rotateIfNeeded(path) {
  try {
    if (statSync(path).size <= CLI_LOG_MAX_BYTES) return;
    renameSync(path, `${path}.1`);
  } catch {
    // Missing file (nothing to rotate) or a concurrent rotation — either is fine.
  }
}

/**
 * Serialize one invocation record to a single JSONL line.
 * Exported for the cross-package parity test; the timestamp is injected so the
 * function stays pure.
 */
export function formatCliLogLine(record, timestamp) {
  const entry = {
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
export function logCliInvocation(record, env = process.env) {
  if (!isCliLogEnabled(env)) return;

  try {
    const path = resolveCliLogPath(env);
    rotateIfNeeded(path);
    appendFileSync(path, formatCliLogLine(record, new Date().toISOString()), "utf-8");
  } catch {
    // Read-only cwd, permission denied, disk full — logging is never fatal.
  }
}
