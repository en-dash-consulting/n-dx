/**
 * The context ceiling: when a Sidecar session has read too much to keep, it
 * checkpoints, and its next turn starts cold.
 *
 * A turn that ends above its session's ceiling gets one more turn, in which
 * the agent writes typed ledger entries (`ledger_append`). The turn after that
 * opens a new vendor session whose prompt holds only a freshly built lens
 * packet, the ledger within 3k characters and the last two exchanges verbatim.
 * The old vendor transcript is never re-sent.
 *
 * Ceilings are per scope and read from project config on every turn, so a
 * change applies to the next one:
 *
 *     "web": { "sidecarContextCeiling": { "worktree": 100000, "hub": 40000 } }
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §4.4.
 */

import type { TokenUsage } from "@n-dx/llm-client";
import { HUB_LEDGER_TYPES, LEDGER_ENTRY_MAX_CHARS, WORKTREE_LEDGER_TYPES, type LedgerEntryType } from "./ledger.js";
import { positiveInteger, readWebValue } from "./web-config.js";

export type SidecarScope = "worktree" | "hub";

/** Tokens of context after which a turn checkpoints, by scope. */
export const DEFAULT_CONTEXT_CEILINGS: Readonly<Record<SidecarScope, number>> = {
  worktree: 100_000,
  hub: 40_000,
};

/** Exchanges a cold turn carries verbatim. */
export const COLD_EXCHANGES = 2;

/** One user message and the assistant's reply to it. */
export interface Exchange {
  user: string;
  assistant: string;
}

/** The context a call read: what it sent in, cached or not. */
export function contextTokens(usage: TokenUsage): number {
  return usage.input + (usage.cacheCreationInput ?? 0) + (usage.cacheReadInput ?? 0);
}

/**
 * The ceiling for `scope`: the project's local config, then its shared config,
 * then the default. A value that is not a positive integer is ignored.
 */
export function resolveContextCeiling(projectDir: string, scope: SidecarScope): number {
  const value = readWebValue(projectDir, (web) => {
    const ceilings = web.sidecarContextCeiling;
    return ceilings && typeof ceilings === "object"
      ? positiveInteger((ceilings as Record<string, unknown>)[scope])
      : undefined;
  });
  return value ?? DEFAULT_CONTEXT_CEILINGS[scope];
}

/**
 * The checkpoint turn's prompt: ask for the ledger, nothing else.
 *
 * @param types        what this scope's agent may write
 * @param recoverable  where the next session can read again what it need not note
 */
export function checkpointPrompt(types: readonly LedgerEntryType[], recoverable: string): string {
  return [
    "Your context is full and this session is about to start over with a clean one.",
    "Before it does, record what the next session must not lose: call `ledger_append` once per note.",
    `Types: ${types.join(", ")}. At most ${LEDGER_ENTRY_MAX_CHARS} characters each; keep only what is not recoverable from ${recoverable}.`,
    "Make no other tool calls, then reply with the single word: done.",
  ].join("\n");
}

/** A worktree session's checkpoint prompt. */
export const CHECKPOINT_PROMPT = checkpointPrompt(WORKTREE_LEDGER_TYPES, "the repository");

/** The hub session's: it may also note a decision the operator still has to make. */
export const HUB_CHECKPOINT_PROMPT = checkpointPrompt(HUB_LEDGER_TYPES, "the hub snapshot");

export interface ColdPromptInput {
  /** The rebuilt lens packet text; absent for a lens that sends none. */
  packet?: string;
  /** The ledger rendered within its budget; empty when there are no notes. */
  ledger: string;
  /** The last exchanges, oldest first. */
  exchanges: readonly Exchange[];
  /** The operator's new message. */
  prompt: string;
  /** What happened since the last turn that no tool result reported; see {@link notesSection}. */
  notes?: readonly string[];
}

/**
 * What the session's effects did after their tool results returned (a run
 * that failed after start_work said it started), as a section the agent reads
 * before the operator's message. Undefined with no notes.
 */
function notesSection(notes: readonly string[] | undefined): string | undefined {
  return notes && notes.length > 0 ? `## Since your last turn\n${notes.join("\n\n")}` : undefined;
}

/**
 * The cold turn's prompt. It holds the packet, the ledger, the recent
 * exchanges and the new message, and nothing of the transcript before them.
 */
export function composeColdPrompt(input: ColdPromptInput): string {
  const parts = [
    "This conversation's context was refreshed. You have no memory of it before this message; "
      + "what follows is all that carried over.",
  ];
  if (input.packet) parts.push(input.packet);
  parts.push(`## Session ledger\n${input.ledger || "(no notes were left)"}`);
  if (input.exchanges.length > 0) {
    const turns = input.exchanges
      .map((e) => `**Operator:**\n${e.user}\n\n**You:**\n${e.assistant || "(no reply)"}`)
      .join("\n\n---\n\n");
    parts.push(`## Last ${input.exchanges.length === 1 ? "exchange" : `${input.exchanges.length} exchanges`}\n${turns}`);
  }
  const notes = notesSection(input.notes);
  if (notes) parts.push(notes);
  parts.push(`## Operator's message\n${input.prompt}`);
  return parts.join("\n\n");
}

/**
 * A turn that carries the lens packet, the ledger, notes since the last turn,
 * or any of them, then the operator's message. The ledger rides with the
 * packet: a session opened fresh, re-lensed or handed off to still has its notes.
 */
export function composeOpeningPrompt(input: { packet?: string; ledger?: string; notes?: readonly string[]; prompt: string }): string {
  const parts: string[] = [];
  if (input.packet) parts.push(input.packet);
  if (input.ledger) parts.push(`## Session ledger\n${input.ledger}`);
  const notes = notesSection(input.notes);
  if (notes) parts.push(notes);
  parts.push(`## Operator's message\n${input.prompt}`);
  return parts.join("\n\n");
}
