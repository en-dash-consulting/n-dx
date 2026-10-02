/**
 * Per-run `ndx work` options the dashboard may send with an execute request,
 * and the one table that turns them into command-line flags.
 *
 * Framework-agnostic so the server (which spawns the run), the hub (which
 * queues it) and the viewer (which shows the equivalent command line) all read
 * the same table. Checks here are shape-only — key, type, range, no leading
 * `-`. Checks that need the project (the vendor's model catalog, the
 * provider's vendor support) live on the server.
 *
 * The table mirrors hench's `RUN_OPTIONS` (`ndx work --resolve`'s `options`
 * list); `tests/e2e/run-options-contract.test.js` fails when they disagree.
 */

/** One allow-listed option and the flag it becomes. */
export interface RunOptionSpec {
  /** Key in the request's `options` object. */
  key: RunOptionKey;
  /** The `ndx work` flag, without the leading `--`. Always written `--flag` or `--flag=value`. */
  flag: string;
  type: "enum" | "boolean" | "integer" | "string";
  /** Allowed values, for `enum`. */
  values?: readonly string[];
  /** Inclusive bounds, for `integer`. */
  min?: number;
  max?: number;
  /** UTF-8 byte limit, for `string`. */
  maxBytes?: number;
  /**
   * `file`: the value is written to a file and the flag carries the file's
   * path, which only the server knows. Absent: the flag carries the value.
   */
  via?: "file";
}

export interface RunOptions {
  model?: string;
  provider?: "cli" | "api";
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  review?: boolean;
  reviewModel?: string;
  skipTestGate?: boolean;
  maxTurns?: number;
  tokenBudget?: number;
  fresh?: boolean;
  allowDirty?: boolean;
  contextNotes?: string;
}

export type RunOptionKey = keyof RunOptions;

/** Bytes accepted in `contextNotes`. */
export const CONTEXT_NOTES_MAX_BYTES = 8 * 1024;

/** Bytes accepted in a model id. */
const MODEL_ID_MAX_BYTES = 256;

/**
 * Every allow-listed option, in hench's command-line order. `plan` is not a
 * permission mode a dashboard run may use: an autonomous run in plan mode
 * stalls waiting for approval nobody will give.
 */
export const RUN_OPTION_SPECS: readonly RunOptionSpec[] = [
  { key: "model", flag: "model", type: "string", maxBytes: MODEL_ID_MAX_BYTES },
  { key: "provider", flag: "provider", type: "enum", values: ["cli", "api"] },
  { key: "permissionMode", flag: "permission-mode", type: "enum", values: ["default", "acceptEdits", "bypassPermissions"] },
  { key: "review", flag: "review", type: "boolean" },
  { key: "reviewModel", flag: "review-model", type: "string", maxBytes: MODEL_ID_MAX_BYTES },
  { key: "skipTestGate", flag: "skip-test-gate", type: "boolean" },
  { key: "maxTurns", flag: "max-turns", type: "integer", min: 1, max: 500 },
  { key: "tokenBudget", flag: "token-budget", type: "integer", min: 0 },
  { key: "fresh", flag: "fresh", type: "boolean" },
  { key: "allowDirty", flag: "allow-dirty", type: "boolean" },
  { key: "contextNotes", flag: "context-file", type: "string", maxBytes: CONTEXT_NOTES_MAX_BYTES, via: "file" },
];

/** Checked options, or the first rejected key and why. */
export type RunOptionsCheck =
  | { ok: true; options: RunOptions }
  | { ok: false; key: string; error: string };

const byteLength = (value: string): number => new TextEncoder().encode(value).length;

/** C0, DEL and C1 control characters. */
const CONTROL_CHAR = /[\u0000-\u001f\u007f-\u009f]/;

function checkValue(spec: RunOptionSpec, value: unknown): string | null {
  switch (spec.type) {
    case "boolean":
      return typeof value === "boolean" ? null : "must be true or false";
    case "enum":
      return typeof value === "string" && spec.values!.includes(value)
        ? null
        : `must be one of ${spec.values!.join(", ")}`;
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) return "must be an integer";
      if (spec.min !== undefined && value < spec.min) return `must be at least ${spec.min}`;
      if (spec.max !== undefined && value > spec.max) return `must be at most ${spec.max}`;
      return null;
    }
    case "string": {
      if (typeof value !== "string") return "must be a string";
      if (spec.maxBytes !== undefined && byteLength(value) > spec.maxBytes) {
        return `must be at most ${spec.maxBytes} bytes`;
      }
      // A file's content is never on the command line, so only flag values
      // are held to the command-line rules.
      if (spec.via === "file") return null;
      if (value === "") return "must not be empty";
      if (value.startsWith("-")) return "must not start with '-'";
      if (CONTROL_CHAR.test(value) || /\s/.test(value)) return "must not contain whitespace or control characters";
      return null;
    }
  }
}

/**
 * Check an `options` value against the allow-list. Absent (`undefined`) is
 * no options. The first problem is reported, naming its key.
 */
export function checkRunOptions(input: unknown): RunOptionsCheck {
  if (input === undefined) return { ok: true, options: {} };
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, key: "options", error: "options must be an object" };
  }
  const record = input as Record<string, unknown>;
  const specs = new Map(RUN_OPTION_SPECS.map((spec) => [spec.key as string, spec]));
  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const spec = specs.get(key);
    if (!spec) return { ok: false, key, error: `Unknown run option "${key}"` };
    if (value === undefined) continue;
    const problem = checkValue(spec, value);
    if (problem) return { ok: false, key, error: `Run option "${key}" ${problem}` };
    options[key] = value;
  }
  if (options.reviewModel !== undefined && options.review !== true) {
    return { ok: false, key: "reviewModel", error: 'Run option "reviewModel" requires "review": true' };
  }
  return { ok: true, options: options as RunOptions };
}

/**
 * The `ndx work` flags for checked options, in table order. `false` booleans
 * add nothing. `contextFile` is the path the server wrote `contextNotes` to;
 * without it, `contextNotes` adds nothing (a viewer showing the command line
 * substitutes its own placeholder).
 */
export function runOptionArgs(options: RunOptions, contextFile?: string): string[] {
  const args: string[] = [];
  for (const spec of RUN_OPTION_SPECS) {
    const value = options[spec.key];
    if (value === undefined) continue;
    if (spec.via === "file") {
      if (contextFile !== undefined && value !== "") args.push(`--${spec.flag}=${contextFile}`);
    } else if (spec.type === "boolean") {
      if (value === true) args.push(`--${spec.flag}`);
    } else {
      args.push(`--${spec.flag}=${String(value)}`);
    }
  }
  return args;
}

/** What a dashboard-started `ndx work` run is: one task, its options, the workspace directory. */
export interface WorkCommand {
  taskId: string;
  options: RunOptions;
  /** The directory the run is for — the server's `ctx.projectDir`. */
  dir: string;
  /** Where `contextNotes` was written; see {@link runOptionArgs}. */
  contextFile?: string;
  /** The task's PRD status; a deferred task gets `--reset-deferred` (see {@link resetsDeferred}). */
  taskStatus?: string | null;
}

/**
 * Whether a dashboard run of a task in `status` passes `--reset-deferred`:
 * a deferred task is refused by `ndx work --task` unless the run resets it.
 * Execute, the prep resolve and preview, and the modal's command line all
 * ask this, so the run they describe is the one execute starts.
 */
export function resetsDeferred(status: string | null | undefined): boolean {
  return status === "deferred";
}

/**
 * The `ndx work` argv (without the `ndx` itself) a dashboard execute spawns.
 * The server spawns exactly this and the Prepare task modal prints it, so the
 * command a reader copies is the run they are about to start.
 */
export function workCommandArgs(command: WorkCommand): string[] {
  return [
    "work",
    `--task=${command.taskId}`,
    "--auto",
    ...runOptionArgs(command.options, command.contextFile),
    ...(resetsDeferred(command.taskStatus) ? ["--reset-deferred"] : []),
    command.dir,
  ];
}
