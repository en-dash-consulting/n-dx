/**
 * Plain-language names for transcript tool lines. One pure parser turns a
 * tool's wire name into what the drawer shows; the raw name stays in the
 * expanded details.
 *
 * The viewer cannot import the server's `BROKER_TOOL_NAMES`, so the table
 * below mirrors it; the unit test fails when an entry is missing.
 */

/** The broker's MCP server name; mirrors `SIDECAR_BROKER_NAME` in server/sidecar/broker-policy.ts. */
const BROKER_PREFIX = "mcp__ndx-sidecar__";

/** A readable name for each broker tool, by its wire name. */
export const BROKER_TOOL_LABELS: Readonly<Record<string, string>> = {
  run_command: "Run command",
  start_work: "Start work",
  propose_prd_change: "Propose PRD change",
  propose_run_plan: "Propose run plan",
  place_change_card: "Place change",
  propose_edit: "Propose edit",
  propose_link: "Propose tracker link",
  propose_item_edit: "Propose item edit",
  propose_status: "Propose status",
  ask_choice: "Ask a question",
  github_read: "Read GitHub",
  draft_github_post: "Draft GitHub post",
  migration_decision: "Migration decision",
  save_draft: "Save draft",
  ledger_append: "Add to ledger",
};

export interface ParsedToolName {
  /** What the transcript shows. */
  label: string;
  /** The connection id of an external tool. */
  connection?: string;
  /** The external tool's own name, as the connection lists it. */
  tool?: string;
  /** The broker tool's wire name, without the server prefix. */
  broker?: string;
}

/** "create_ticket" → "create ticket". */
function spaced(name: string): string {
  return name.replace(/_/g, " ");
}

/** "run_command" → "Run command" for a name outside the table. */
function sentence(name: string): string {
  const words = spaced(name).trim();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : name;
}

/**
 * Read a tool's wire name.
 * - `mcp__ndx-sidecar__<tool>`: a broker tool, from the table (an unknown one reads as its name with spaces).
 * - `mcp__ndx-sidecar__<id>__<tool>`: an external tool, "<connection label or id> · <tool with spaces>".
 * - any other `mcp__<server>__<tool>`: the last segment.
 * - anything else (Bash, Read, shell): unchanged.
 * `connectionLabels` maps a connection id to the label the viewer knows it by.
 */
export function parseToolName(wire: string, connectionLabels: Readonly<Record<string, string>> = {}): ParsedToolName {
  if (wire.startsWith(BROKER_PREFIX)) {
    const rest = wire.slice(BROKER_PREFIX.length);
    const split = rest.indexOf("__");
    if (split > 0 && split + 2 < rest.length) {
      const connection = rest.slice(0, split);
      const tool = rest.slice(split + 2);
      return { label: `${connectionLabels[connection] ?? connection} · ${spaced(tool)}`, connection, tool };
    }
    if (rest === "") return { label: wire };
    return { label: BROKER_TOOL_LABELS[rest] ?? sentence(rest), broker: rest };
  }
  if (wire.startsWith("mcp__")) {
    const segments = wire.split("__").filter((s) => s !== "");
    const last = segments[segments.length - 1];
    if (segments.length > 1 && last) return { label: last };
  }
  return { label: wire };
}

export type ToolLineStatus = "running" | "done" | "failed" | "waiting";

/** The short status shown beside the dot. */
export const TOOL_STATUS_TEXT: Readonly<Record<ToolLineStatus, string>> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  waiting: "Waiting for you",
};

/** The slice of a card a tool line reads. */
export interface ToolLineCard {
  tool: string;
  input: Record<string, unknown>;
  status: "pending" | "approved" | "denied" | "withdrawn";
  carriedOut?: { ok: boolean };
  externalCall?: { label: string };
  /** The operator edited the call before approving it, so its input no longer matches the agent's. */
  edited?: true;
}

/** Structural equality of two JSON values, key order ignored. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Whether a card is the one a call raised: the broker tool by name, an
 * external call by connection and tool (the card names it `<connection>.<tool>`),
 * and in both cases the same input. Many calls raise no card (an allow-listed
 * command, a refused call, an external tool the connection allows), so the
 * input keeps a later call's card from being claimed by an earlier one. An
 * edited card's input is the operator's, so it matches by tool alone.
 */
export function cardIsForCall(
  card: Pick<ToolLineCard, "tool" | "input" | "edited">,
  parsed: ParsedToolName,
  input: Record<string, unknown>,
): boolean {
  if (parsed.broker) return card.tool === parsed.broker && (card.edited === true || sameJson(card.input, input));
  if (!parsed.connection || card.tool !== "external_call") return false;
  return card.input.connection === parsed.connection
    && card.input.tool === `${parsed.connection}.${parsed.tool}`
    && (card.edited === true || sameJson(card.input.arguments, input));
}

/** Connection id → label, from the external-call cards the viewer holds. */
export function connectionLabelsFromCards(cards: readonly ToolLineCard[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const card of cards) {
    const id = card.input.connection;
    if (typeof id === "string" && card.externalCall?.label) labels[id] = card.externalCall.label;
  }
  return labels;
}

/**
 * A call's status: waiting while its card is pending, failed when the operator
 * denied or the card was withdrawn or its effect failed, done once a result
 * is in, else running. A result that is itself an error (`resultFailed`)
 * reads failed even with no card: a call that raised none, such as a refusal.
 */
export function toolLineStatus(card: ToolLineCard | undefined, hasResult: boolean, resultFailed = false): ToolLineStatus {
  if (card?.status === "pending") return "waiting";
  if (card && (card.status === "denied" || card.status === "withdrawn" || card.carriedOut?.ok === false)) return "failed";
  if (hasResult && resultFailed) return "failed";
  return hasResult ? "done" : "running";
}

/**
 * Whether a tool result is a failure. The vendor parser sets `isError` when
 * the stream reports it (Claude's `is_error`, which includes a broker refusal;
 * a Codex command's failed status or non-zero exit), and it wins. Frames
 * recorded before the flag existed have none: for them, fall back to the
 * `[error] ` prefix the Claude parser writes on an `is_error` result.
 */
export function toolResultFailed(result: { output: string; isError?: boolean }): boolean {
  return result.isError ?? result.output.startsWith("[error] ");
}
