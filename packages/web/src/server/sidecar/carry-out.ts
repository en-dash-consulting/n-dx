/**
 * What an approved broker call does.
 *
 * The broker decides a call (`broker.ts`); this module carries out the
 * decided call and words the tool result the session's agent reads. Three
 * tools run today: `run_command` as the workspace's Sidecar command job,
 * `start_work` through the hench execute route, and `propose_prd_change` as
 * its change-set card's PRD write (`change-set.ts`), with the operator's
 * edits. Every other approved call is recorded on its card and names the
 * batch that will carry it out.
 *
 * The effects themselves are injected ({@link SidecarActions}): the command
 * job model and the execute route own their spawns, so this module never
 * spawns and imports neither.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §4.3, §12.
 */

import type { SidecarChangeSet } from "../../shared/index.js";
import type { BrokerToolName } from "./broker-policy.js";
import type { BrokerOutcome } from "./broker.js";

/** One effect's result, as the tool result states it. */
export interface CarryOutResult {
  ok: boolean;
  text: string;
  /** The PRD items the effect wrote, in order. */
  ids?: string[];
}

/** The effects an approved call can have, wired to the server's job model and execute route. */
export interface SidecarActions {
  /** A work card's preview: the task's `ndx work --resolve`, rendered. Never throws. */
  previewWork(taskId: string, options: Record<string, unknown> | undefined): Promise<string>;
  /** Runs the command and waits for it (see {@link awaitSidecarCommand}); `signal` aborts the wait, never the command. */
  runCommand(argv: string[], signal?: AbortSignal): Promise<CarryOutResult> | CarryOutResult;
  startWork(taskId: string, options: Record<string, unknown> | undefined): Promise<CarryOutResult>;
  /** A proposal read against the PRD for its change-set card, or why it cannot be written. */
  reviewChangeSet(input: Record<string, unknown>): Promise<SidecarChangeSet | string>;
  /** An approved change-set card's write, under the PRD lock. Never throws. */
  writeChangeSet(changeSet: SidecarChangeSet): Promise<CarryOutResult>;
}

/** The tools that are recorded but not carried out yet, and the batch that will carry each out. */
export const CARRIED_OUT_LATER: Readonly<Partial<Record<BrokerToolName, string>>> = {
  place_change_card: "the L2 Place lens",
  propose_edit: "a later batch",
  github_read: "L2/H1",
  draft_github_post: "L2/H1",
  migration_decision: "G1",
};

/** The tool result for a decided call: the effect when approved, else why nothing ran. */
export async function carryOutDecision(
  tool: BrokerToolName,
  input: Record<string, unknown>,
  outcome: BrokerOutcome,
  actions: SidecarActions | undefined,
  signal?: AbortSignal,
): Promise<CarryOutResult> {
  if (outcome.decidedBy !== "allow-list") {
    const { card } = outcome;
    const note = card.reason ? ` Operator's note: ${card.reason}` : "";
    if (outcome.decidedBy === "withdrawn") {
      return { ok: false, text: `Card ${card.id} was withdrawn: ${card.reason ?? "the turn stopped"}. Nothing ran.` };
    }
    if (!outcome.approved) return { ok: false, text: `The operator denied card ${card.id}. Nothing ran.${note}` };
  }
  const decided = outcome.decidedBy === "allow-list"
    ? "Allowed by the Sidecar allow-list."
    : `The operator approved card ${outcome.card.id}.${outcome.card.reason ? ` Operator's note: ${outcome.card.reason}` : ""}`;
  const effect = await carryOut(tool, input, outcome, actions, signal);
  return { ...effect, text: `${decided} ${effect.text}` };
}

async function carryOut(
  tool: BrokerToolName,
  input: Record<string, unknown>,
  outcome: BrokerOutcome,
  actions: SidecarActions | undefined,
  signal: AbortSignal | undefined,
): Promise<CarryOutResult> {
  const later = CARRIED_OUT_LATER[tool];
  if (later !== undefined) return { ok: true, text: `Recorded, not carried out yet: ${later} carries out ${tool} calls.` };
  if (!actions) return { ok: false, text: `This server cannot carry out ${tool} calls; nothing ran.` };
  switch (tool) {
    case "run_command":
      return actions.runCommand((input.argv as unknown[]).map(String), signal);
    case "start_work":
      return actions.startWork(String(input.taskId), workOptions(input));
    case "propose_prd_change": {
      // The card's change set, with the operator's edits; never the raw input.
      const changeSet = outcome.decidedBy === "allow-list" ? undefined : outcome.card.changeSet;
      if (!changeSet) return { ok: false, text: "The card carried no change set; nothing was written." };
      const written = await actions.writeChangeSet(changeSet);
      // Said only of a write that happened: a failed one wrote no values at all.
      const edited = written.ok && outcome.decidedBy !== "allow-list" && outcome.card.edited
        ? " The operator edited it before approving; the edited values were written."
        : "";
      return { ...written, text: `${written.text}${edited}` };
    }
    default:
      return { ok: false, text: `${tool} has no effect to carry out; nothing ran.` };
  }
}

/**
 * A work card's preview from `ndx work --resolve`'s JSON: the command line,
 * the task, every resolved setting with the key that supplied it, and any
 * refusal or warning hench states.
 */
export function renderWorkPreview(resolution: Record<string, unknown>): string {
  const lines: string[] = [];
  if (typeof resolution.command === "string") lines.push(resolution.command);
  const task = resolution.task as { title?: unknown; status?: unknown } | null | undefined;
  lines.push(task ? `Task: ${String(task.title)} (${String(task.status)})` : "Task: not found in the PRD");
  const resolved = resolution.resolved;
  if (resolved && typeof resolved === "object") {
    for (const [key, setting] of Object.entries(resolved as Record<string, { value?: unknown; source?: unknown }>)) {
      lines.push(`${key} = ${JSON.stringify(setting?.value ?? null)} (from ${String(setting?.source ?? "unknown")})`);
    }
  }
  const notes = (field: string, heading: string): void => {
    const list = Array.isArray(resolution[field]) ? resolution[field] as Array<{ code?: unknown; message?: unknown }> : [];
    if (list.length === 0) return;
    lines.push(`${heading}:`, ...list.map((n) => `- ${String(n.code)}: ${String(n.message)}`));
  };
  notes("refusals", "Refusals");
  notes("warnings", "Warnings");
  return lines.join("\n");
}

/** How a Sidecar command job ended. */
export interface SidecarCommandEnd {
  /** The exit code; null when the command never exited by itself (timed out, stopped, or failed to start). */
  exitCode: number | null;
  /** Everything it printed: stdout, then stderr. */
  output: string;
  error: string | null;
  /** True when Stop in the job tray ended it. */
  stopped: boolean;
}

/** A started Sidecar command, as {@link awaitSidecarCommand} waits on it. */
export interface SidecarCommandJob {
  jobId: string;
  command: string;
  settled: Promise<SidecarCommandEnd>;
}

/** How long the agent waits on a command before it is told the job carries on. */
export const SIDECAR_COMMAND_WAIT_MS = 60_000;
/** The output tail a tool result carries: its last lines, within a byte budget. */
export const SIDECAR_OUTPUT_MAX_LINES = 80;
export const SIDECAR_OUTPUT_MAX_BYTES = 8 * 1024;

/**
 * The tool result for a started command: its exit status and output tail
 * when it ends within `waitMs`, else that it is still running. A stopped turn
 * (`signal`) answers at once. Neither the bound nor the signal stops the job;
 * Stop in the job tray does.
 */
export async function awaitSidecarCommand(
  job: SidecarCommandJob,
  waitMs: number,
  signal?: AbortSignal,
): Promise<CarryOutResult> {
  const still: CarryOutResult = {
    ok: true,
    text: `\`${job.command}\` is still running as job ${job.jobId}; output in the job tray and on Live.`,
  };
  if (signal?.aborted) return still;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const cutShort = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
    onAbort = () => resolve(null);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const end = await Promise.race([job.settled, cutShort]);
    return end ? commandEndResult(job, end) : still;
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

function commandEndResult(job: SidecarCommandJob, end: SidecarCommandEnd): CarryOutResult {
  const ended = end.stopped
    ? "was stopped from the job tray"
    : end.exitCode === null
      ? `ended without an exit code: ${end.error ?? "unknown error"}`
      : `exited with code ${end.exitCode}`;
  const tail = outputTail(end.output);
  const body = tail.text
    ? `\n${tail.cutBytes > 0 ? `Output, cut to its end (${tail.cutLines} lines, ${tail.cutBytes} bytes cut before it):` : "Output:"}\n${tail.text}`
    : "\nIt printed nothing.";
  return { ok: end.exitCode === 0 && !end.stopped, text: `\`${job.command}\` (job ${job.jobId}) ${ended}.${body}` };
}

/**
 * The end of `output`: at most {@link SIDECAR_OUTPUT_MAX_LINES} lines and
 * {@link SIDECAR_OUTPUT_MAX_BYTES} UTF-8 bytes, cut at line starts. A last
 * line longer than the budget keeps its end.
 */
export function outputTail(output: string): { text: string; cutLines: number; cutBytes: number } {
  const lines = output.replace(/\s+$/, "").split("\n");
  if (lines.length === 1 && lines[0] === "") return { text: "", cutLines: 0, cutBytes: 0 };
  const kept: string[] = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0 && kept.length < SIDECAR_OUTPUT_MAX_LINES; i -= 1) {
    const size = Buffer.byteLength(lines[i]) + (kept.length > 0 ? 1 : 0);
    if (bytes + size > SIDECAR_OUTPUT_MAX_BYTES) {
      if (kept.length === 0) {
        const end = Buffer.from(lines[i]).subarray(-SIDECAR_OUTPUT_MAX_BYTES).toString("utf-8").replace(/^�+/, "");
        kept.unshift(end);
      }
      break;
    }
    kept.unshift(lines[i]);
    bytes += size;
  }
  const text = kept.join("\n");
  return {
    text,
    cutLines: lines.length - kept.length,
    cutBytes: Buffer.byteLength(lines.join("\n")) - Buffer.byteLength(text),
  };
}

/** A start_work call's run options, when it gave any. */
export function workOptions(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const { options } = input;
  return options && typeof options === "object" && !Array.isArray(options) ? options as Record<string, unknown> : undefined;
}
