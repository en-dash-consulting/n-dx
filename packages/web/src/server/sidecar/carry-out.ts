/**
 * What an approved broker call does.
 *
 * The broker decides a call (`broker.ts`); this module carries out the
 * decided call and words the tool result the session's agent reads. Seven
 * tools run today: `run_command` as the workspace's Sidecar command job,
 * `start_work` through the hench execute route, `propose_prd_change` as
 * its change-set card's PRD write (`change-set.ts`), with the operator's
 * edits, `propose_run_plan`, which starts nothing: it names the chosen
 * lane's first task for a `start_work` card, `place_change_card` as its
 * placement card's write through rex's place or propose rule (the one
 * `POST /api/rex/changes/:id/place` and `/propose` write through),
 * `github_read` as a gh read
 * (`github.ts`), allowed by the card or by `web.sidecarGithubReads`, and
 * `draft_github_post`, posted under the operator's gh login only when its
 * card is approved. Every other approved call is recorded on its card and
 * names the batch that will carry it out.
 *
 * The effects themselves are injected ({@link SidecarActions}): the command
 * job model and the execute route own their spawns, so this module never
 * spawns and imports neither.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §4.3, §12.
 */

import { laneSteps, stepRunOptions } from "../../shared/index.js";
import type { QueuePlan, SidecarChangeSet, SidecarPlacement } from "../../shared/index.js";
import type { BrokerToolName } from "./broker-policy.js";
import type { BrokerOutcome, SidecarCard } from "./broker.js";

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
  writeChangeSet(changeSet: SidecarChangeSet, sessionId: string): Promise<CarryOutResult>;
  /** A placement call read and dry-run through rex on the PRD as loaded, for its card; a string says why no card can be raised. Writes nothing. */
  checkPlacement(input: Record<string, unknown>): Promise<SidecarPlacement | string>;
  /** An approved placement card's write through rex's rule, under the PRD lock. Never throws; a refusal names rex's kind. */
  writePlacement(placement: SidecarPlacement, sessionId: string): Promise<CarryOutResult>;
  /** The queue planner's plan for a run-plan card, or why there is none to raise a card for. Never throws. */
  readRunPlan(signal?: AbortSignal): Promise<QueuePlan | string>;
  /** `web.sidecarGithubReads`, read per call: on, a `github_read` runs without a card. */
  githubReadsAllowed(): boolean;
  /** `git.branchHealth`, read per call: off, a `pr` read reads nothing and raises no card. */
  branchHealthEnabled(): boolean;
  /** A `github_read`, run with gh. Never throws. */
  githubRead(read: GithubRead, signal?: AbortSignal): Promise<CarryOutResult>;
  /** An approved draft, posted under the operator's gh login. Never throws. */
  postGithub(draft: GithubDraft): Promise<CarryOutResult>;
}

/** `pr`: the worktree a workspace key names, its PR and checks. `check`: one check's newest run on a base branch. */
export const GITHUB_READ_KINDS = ["pr", "check"] as const;
/** `comment`: a PR comment. `review`: a review comment on a PR. */
export const GITHUB_POST_KINDS = ["comment", "review"] as const;

/** A `github_read` call: the attached worktree's PR and checks, or one check on a base branch. */
export type GithubRead = { kind: "pr"; ref: string } | { kind: "check"; ref: string; base: string };

/** A `draft_github_post` call: a PR comment, or a review comment, with its body. */
export interface GithubDraft {
  kind: (typeof GITHUB_POST_KINDS)[number];
  target: string;
  body: string;
}

/** A `github_read` call as {@link GithubRead}, or why it cannot be one. */
export function githubReadOf(input: Record<string, unknown>): GithubRead | string {
  const ref = typeof input.ref === "string" ? input.ref.trim() : "";
  if (!ref) return "a github_read needs a ref";
  if (input.kind === "pr") return { kind: "pr", ref };
  if (input.kind === "check") {
    const base = typeof input.base === "string" ? input.base.trim() : "";
    return base ? { kind: "check", ref, base } : "a check read needs the base branch to read it on (base)";
  }
  return `a github_read kind is "pr" or "check", not ${JSON.stringify(input.kind)}`;
}

/** The tools that are recorded but not carried out yet, and the batch that will carry each out. */
export const CARRIED_OUT_LATER: Readonly<Partial<Record<BrokerToolName, string>>> = {
  propose_edit: "a later batch",
  migration_decision: "G1",
};

/** How a call was settled: by the broker, or by a project setting that allows it without a card. */
export type CallDecision = BrokerOutcome | { approved: true; decidedBy: "project-allowance"; setting: string };

/** The tool result for a decided call: the effect when approved, else why nothing ran. */
export async function carryOutDecision(
  tool: BrokerToolName,
  input: Record<string, unknown>,
  outcome: CallDecision,
  actions: SidecarActions | undefined,
  signal?: AbortSignal,
): Promise<CarryOutResult> {
  if (outcome.decidedBy === "operator" || outcome.decidedBy === "withdrawn") {
    const { card } = outcome;
    const note = card.reason ? ` Operator's note: ${card.reason}` : "";
    const nothing = tool === "draft_github_post" ? "Nothing was posted." : "Nothing ran.";
    if (outcome.decidedBy === "withdrawn") {
      return { ok: false, text: `Card ${card.id} was withdrawn: ${card.reason ?? "the turn stopped"}. ${nothing}` };
    }
    if (!outcome.approved) return { ok: false, text: `The operator denied card ${card.id}. ${nothing}${note}` };
  }
  const decided = outcome.decidedBy === "allow-list"
    ? "Allowed by the Sidecar allow-list."
    : outcome.decidedBy === "project-allowance"
      ? `Allowed for this project by ${outcome.setting}.`
      : `The operator approved card ${outcome.card.id}.${outcome.card.reason ? ` Operator's note: ${outcome.card.reason}` : ""}`;
  const effect = await carryOut(tool, input, outcome, actions, signal);
  return { ...effect, text: `${decided} ${effect.text}` };
}

/** The card that decided a call; none when an allowance did. */
function cardOf(outcome: CallDecision): SidecarCard | undefined {
  return outcome.decidedBy === "operator" || outcome.decidedBy === "withdrawn" ? outcome.card : undefined;
}

async function carryOut(
  tool: BrokerToolName,
  input: Record<string, unknown>,
  outcome: CallDecision,
  actions: SidecarActions | undefined,
  signal: AbortSignal | undefined,
): Promise<CarryOutResult> {
  const later = CARRIED_OUT_LATER[tool];
  if (later !== undefined) return { ok: true, text: `Recorded, not carried out yet: ${later} carries out ${tool} calls.` };
  if (!actions) return { ok: false, text: `This server cannot carry out ${tool} calls; nothing ran.` };
  const card = cardOf(outcome);
  switch (tool) {
    case "run_command":
      return actions.runCommand((input.argv as unknown[]).map(String), signal);
    case "start_work":
      return actions.startWork(String(input.taskId), workOptions(input));
    case "propose_prd_change": {
      // The card's change set, with the operator's edits; never the raw input.
      const changeSet = card?.changeSet;
      if (!changeSet) return { ok: false, text: "The card carried no change set; nothing was written." };
      const written = await actions.writeChangeSet(changeSet, card.sessionId);
      // Said only of a write that happened: a failed one wrote no values at all.
      const edited = written.ok && card?.edited
        ? " The operator edited it before approving; the edited values were written."
        : "";
      return { ...written, text: `${written.text}${edited}` };
    }
    case "propose_run_plan":
      return runPlanResult(card);
    case "place_change_card": {
      // The card's placement, read and dry-run when it was raised; never the raw input.
      if (!card?.placement) return { ok: false, text: "A placement is written only from its approved card; nothing was written." };
      return actions.writePlacement(card.placement, card.sessionId);
    }
    case "github_read": {
      const read = githubReadOf(input);
      return typeof read === "string" ? { ok: false, text: `Nothing was read: ${read}.` } : actions.githubRead(read, signal);
    }
    case "draft_github_post": {
      // Posted only from an approved card, and exactly the draft the operator read on it.
      if (!card) return { ok: false, text: "A draft is posted only from an approved card; nothing was posted." };
      const { kind, target, body } = card.input;
      // A target gh would read as a flag is never passed to it, whatever raised the card.
      if (!(GITHUB_POST_KINDS as readonly unknown[]).includes(kind) || typeof target !== "string" || !/^[^-\s]\S*$/.test(target) || typeof body !== "string") {
        return { ok: false, text: "The card carried no draft to post; nothing was posted." };
      }
      return actions.postGithub({ kind: kind as GithubDraft["kind"], target, body });
    }
    default:
      return { ok: false, text: `${tool} has no effect to carry out; nothing ran.` };
  }
}

/**
 * The result of an approved run-plan card: the operator chose a lane, and
 * the agent is told to raise `start_work` for that lane's first task alone,
 * with the run options that carry its step's extra flags
 * (`--require-unblocked` is `requireUnblocked: true`, so a later task whose
 * blocker did not complete is refused rather than started). Nothing starts
 * here; the work card is what the operator approves next. A first step with a
 * flag no run option carries is not started from a card, and the result says so.
 */
function runPlanResult(card: SidecarCard | undefined): CarryOutResult {
  if (!card) return { ok: false, text: "A run plan is never allowed without its card; nothing ran." };
  const { runPlan, lane: chosen } = card;
  const lane = runPlan && chosen !== undefined ? runPlan.lanes[chosen] : undefined;
  if (!runPlan || !lane || chosen === undefined || lane.tasks.length === 0) return { ok: false, text: "The card carried no lane; nothing started." };
  const steps = laneSteps(lane);
  const [first, ...rest] = lane.tasks;
  const { unmapped } = stepRunOptions(steps[0] ?? "");
  if (unmapped.length > 0) {
    return {
      ok: false,
      text: `Lane ${chosen + 1} was chosen, but its first step is \`${steps[0]}\`, which carries ${unmapped.join(" ")} and a work card cannot. Nothing started; tell the operator to run the lane's command from a terminal.`,
    };
  }
  const remaining = rest.map((task, i) => `${task.id} ${task.title}: ${steps[i + 1] ?? "(no command)"}${withOptions(steps[i + 1])}`);
  const later = remaining.length > 0
    ? ` Its other tasks wait, in order: ${remaining.join("; ")}. Do not start them now: when this task's run has ended, raise the next start_work card in a later turn, with the options named for its step.`
    : "";
  return {
    ok: true,
    text: `The operator chose lane ${chosen + 1} (change ${lane.changeId}). Nothing has started. Call start_work for its first task only: ${first.id} ${first.title} (\`${steps[0]}\`)${withOptions(steps[0])}.${later}`,
  };
}

/** ` — start_work options {…}` for a step whose extra flags map to run options; empty when it has none. */
function withOptions(step: string | undefined): string {
  const { options } = stepRunOptions(step ?? "");
  return Object.keys(options).length > 0 ? ` — start_work options ${JSON.stringify(options)}` : "";
}

/** A blocker of the task, as a work card's preview names it. */
export interface PreviewBlocker {
  id: string;
  title: string;
  status: string;
}

/**
 * A work card's preview from `ndx work --resolve`'s JSON: the command line,
 * the task, the task's blockers that are not completed (an explicit task
 * starts over them unless `requireUnblocked` is set), every resolved setting
 * with the key that supplied it, and any refusal or warning hench states.
 */
export function renderWorkPreview(resolution: Record<string, unknown>, openBlockers: readonly PreviewBlocker[] = []): string {
  const lines: string[] = [];
  if (typeof resolution.command === "string") lines.push(resolution.command);
  const task = resolution.task as { title?: unknown; status?: unknown } | null | undefined;
  lines.push(task ? `Task: ${String(task.title)} (${String(task.status)})` : "Task: not found in the PRD");
  if (openBlockers.length > 0) {
    lines.push("Waiting on unfinished blockers:", ...openBlockers.map((b) => `- ${b.title} (${b.id}, ${b.status})`));
  }
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

/**
 * A start_work call's run options. `requireUnblocked` defaults to true, so a
 * task with an unfinished blocker is refused unless the call passes `false`
 * explicitly; an agent that drops the options cannot start over a blocker.
 * The broker puts the result on the work card, so its preview, its title and
 * the start all read one set of options and the card's command is the run.
 */
export function workOptions(input: Record<string, unknown>): Record<string, unknown> {
  const { options } = input;
  const given = options && typeof options === "object" && !Array.isArray(options) ? options as Record<string, unknown> : {};
  const { requireUnblocked, ...rest } = given;
  return requireUnblocked === false ? rest : { ...rest, requireUnblocked: true };
}
