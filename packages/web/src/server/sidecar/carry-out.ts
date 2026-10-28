/**
 * What an approved broker call does.
 *
 * The broker decides a call (`broker.ts`); this module carries out the
 * decided call and words the tool result the session's agent reads. Two tools
 * run today: `run_command` as the workspace's Sidecar command job, and
 * `start_work` through the hench execute route. Every other approved call is
 * recorded on its card and names the batch that will carry it out.
 *
 * The effects themselves are injected ({@link SidecarActions}): the command
 * job model and the execute route own their spawns, so this module never
 * spawns and imports neither.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §4.3, §12.
 */

import type { BrokerToolName } from "./broker-policy.js";
import type { BrokerOutcome } from "./broker.js";

/** One effect's result, as the tool result states it. */
export interface CarryOutResult {
  ok: boolean;
  text: string;
}

/** The effects an approved call can have, wired to the server's job model and execute route. */
export interface SidecarActions {
  /** A work card's preview: the task's `ndx work --resolve`, rendered. Never throws. */
  previewWork(taskId: string, options: Record<string, unknown> | undefined): Promise<string>;
  runCommand(argv: string[]): Promise<CarryOutResult> | CarryOutResult;
  startWork(taskId: string, options: Record<string, unknown> | undefined): Promise<CarryOutResult>;
}

/** The tools that are recorded but not carried out yet, and the batch that will carry each out. */
export const CARRIED_OUT_LATER: Readonly<Partial<Record<BrokerToolName, string>>> = {
  propose_prd_change: "the change-set card (M3, story 11)",
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
  const effect = await carryOut(tool, input, actions);
  return { ok: effect.ok, text: `${decided} ${effect.text}` };
}

async function carryOut(
  tool: BrokerToolName,
  input: Record<string, unknown>,
  actions: SidecarActions | undefined,
): Promise<CarryOutResult> {
  const later = CARRIED_OUT_LATER[tool];
  if (later !== undefined) return { ok: true, text: `Recorded, not carried out yet: ${later} carries out ${tool} calls.` };
  if (!actions) return { ok: false, text: `This server cannot carry out ${tool} calls; nothing ran.` };
  switch (tool) {
    case "run_command":
      return actions.runCommand((input.argv as unknown[]).map(String));
    case "start_work":
      return actions.startWork(String(input.taskId), workOptions(input));
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

/** A start_work call's run options, when it gave any. */
export function workOptions(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const { options } = input;
  return options && typeof options === "object" && !Array.isArray(options) ? options as Record<string, unknown> : undefined;
}
