/**
 * The `ndx-sidecar` action broker: permission cards, the Sidecar allow-list
 * and the session ledger.
 *
 * A broker write tool calls {@link SidecarBroker.request}, which settles at
 * once when the call matches a rule on the Sidecar allow-list and otherwise
 * raises a card and waits for the operator's decision. The allow-list is the
 * broker's own (`<dir>/allow-list.json`); the vendor CLI's settings and their
 * `permissions.allow` rules are never loaded (see `spawn-policy.ts`), so
 * nothing but this class decides a broker call.
 *
 * Cards are decided in order: a session's agent waits on its first undecided
 * card, so only that one can be decided. Every settled card is appended to
 * `<dir>/<session>.cards.jsonl`, the audit trail.
 *
 * Cards live in memory. A server restart drops pending ones, which is safe:
 * the vendor CLI that waited on them was a child of the server's turn.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { writeRunFileAtomic } from "../run-end.js";
import {
  allowListKey,
  BROKER_TOOL_POLICY,
  isBrokerTool,
  type AllowListRule,
  type BrokerCardTool,
  type SidecarCardKind,
} from "./broker-policy.js";
import type { QueuePlan, SidecarCallProblem, SidecarChangeSet, SidecarExternalCall, SidecarLink, SidecarPlacement } from "../../shared/index.js";
import { applyChangeSetEdits } from "./change-set.js";
import { IDEMPOTENCY_KEY_PROPERTIES } from "./external-call.js";
import { appendLedgerEntryAt, sessionLedgerPath, WORKTREE_LEDGER_TYPES, type LedgerEntry, type LedgerEntryType } from "./ledger.js";
import { resolveDraftPath } from "./draft-file.js";
import { ensureSidecarDir } from "./sidecar-dir.js";

export type SidecarCardStatus = "pending" | "approved" | "denied" | "withdrawn";

export interface SidecarCard {
  id: string;
  sessionId: string;
  tool: BrokerCardTool;
  kind: SidecarCardKind;
  input: Record<string, unknown>;
  /** The rule "always allow" would add; `null` when the call can never be allow-listed. */
  allowListKey: string | null;
  /** What the call would do, read before the card was raised: a work card's `ndx work --resolve`. */
  preview?: string;
  /** A work card's run options as start uses them (`workOptions`), defaults applied; the viewer titles the card from these. */
  runOptions?: Record<string, unknown>;
  /** A change-set card's items as approval writes them, read against the PRD before the card was raised. */
  changeSet?: SidecarChangeSet;
  /** A run-plan card's plan as the planner printed it when the card was raised; its commands are never the model's. */
  runPlan?: QueuePlan;
  /** A placement card's placement as approval writes it, with rex's dry run from when the card was raised. */
  placement?: SidecarPlacement;
  /** A link card's item, work ref and tracker label as approval writes them, read when the card was raised. */
  link?: SidecarLink;
  /** An external-call card's connection, workspace, input schema and picker choices. */
  externalCall?: SidecarExternalCall;
  /** The lane (0-based) the operator chose to start on a run-plan card. */
  lane?: number;
  status: SidecarCardStatus;
  raisedAt: string;
  decidedAt?: string;
  /** The operator's note on a decision, or why a card was withdrawn. */
  reason?: string;
  /** Approved with "always allow": its rule went onto the allow-list. */
  remembered?: true;
  /** The operator edited the change set, the placement, a draft file's path or an external call's arguments before approving it. */
  edited?: true;
  /**
   * How the approved call's effect ended; `ids` are the PRD items a change-set
   * card wrote, `problems` the list an external server's validation error
   * returned (the session got the result unchanged).
   */
  carriedOut?: { ok: boolean; ids?: string[]; problems?: SidecarCallProblem[] };
}

/** What the broker reads before raising a card, for the operator to see on it. */
export interface CardAnnex {
  preview?: string;
  runOptions?: Record<string, unknown>;
  changeSet?: SidecarChangeSet;
  runPlan?: QueuePlan;
  placement?: SidecarPlacement;
  link?: SidecarLink;
  externalCall?: SidecarExternalCall;
}

/** How a broker call was settled. */
export type BrokerOutcome =
  | { approved: true; decidedBy: "allow-list" }
  | { approved: boolean; decidedBy: "operator" | "withdrawn"; card: SidecarCard };

export interface CardDecision {
  approve: boolean;
  reason?: string;
  /** Also add the call's rule to the allow-list. Refused for a call that can never be allow-listed. */
  remember?: boolean;
  /** A change-set card's item edits, written by the approval. Refused on any other card or decision. */
  edits?: unknown;
  /**
   * A placement card's edited placement, already read and dry-run against the
   * PRD (`readPlacementEdit`): approval writes it in place of the card's own.
   * Only on a placement approval, and only a placement rex accepted.
   */
  placement?: Pick<SidecarPlacement, "request" | "check">;
  /** A run-plan card's Start lane: the lane (0-based) whose first task is to be started. Only on a run-plan approval, and required there. */
  lane?: number;
  /** A draft-file card's path as the operator edited it; the approval saves there. Only on a draft-file approval. */
  path?: string;
  /**
   * An external-call card's arguments as the operator edited them; the
   * approval calls the tool with these. Only on an external-call approval. An
   * idempotency key is read-only: the agent's value is kept, and one the agent
   * did not send cannot be added.
   */
  arguments?: unknown;
}

/** A refused decision; `status` is the HTTP status a route answers with. */
export class BrokerDecisionError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

export interface SidecarBrokerOptions {
  /** The Sidecar directory: the allow-list, card audit and ledgers. */
  dir: string;
  /** Called when a card is raised or settled. */
  onCard?: (card: SidecarCard) => void;
  now?: () => number;
  /**
   * Where a session's ledger is and what its agent may write there. Defaults
   * to a worktree's: `<dir>/<session>.ledger.jsonl`, {@link WORKTREE_LEDGER_TYPES}.
   */
  ledger?: SidecarLedgerTarget;
  /** Where a draft-file card's relative path lands. Defaults to `<dir>/drafts`. */
  draftsDir?: string;
}

export interface SidecarLedgerTarget {
  path: (sessionId: string) => string;
  /** The types `ledger_append` accepts. */
  types: readonly LedgerEntryType[];
}

interface PendingCard {
  card: SidecarCard;
  settle: (outcome: BrokerOutcome) => void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const ALLOW_LIST_SCHEMA = "ndx/sidecar-allow-list/v1";
const ALLOW_LIST_NAME = "allow-list";

export class SidecarBroker {
  private readonly dir: string;
  private readonly onCard?: (card: SidecarCard) => void;
  private readonly now: () => number;
  /** Every card raised since the server started, per session, oldest first. */
  private readonly sessionCards = new Map<string, SidecarCard[]>();
  /** Per session, what its next turn tells the agent: an effect that failed after its tool result returned. */
  private readonly turnNotes = new Map<string, string[]>();
  private readonly pending = new Map<string, PendingCard>();
  /** Per session, the decided calls still carrying out their effect; `withdraw` aborts them. */
  private readonly carrying = new Map<string, Set<AbortController>>();
  private readonly ledger: SidecarLedgerTarget;
  private readonly draftsDirPath: string;

  constructor(opts: SidecarBrokerOptions) {
    this.dir = opts.dir;
    this.draftsDirPath = opts.draftsDir ?? join(opts.dir, "drafts");
    this.onCard = opts.onCard;
    this.now = opts.now ?? Date.now;
    this.ledger = opts.ledger ?? { path: (sessionId) => sessionLedgerPath(opts.dir, sessionId), types: WORKTREE_LEDGER_TYPES };
  }

  /** Where a draft file's relative path lands. */
  get draftsDir(): string {
    return this.draftsDirPath;
  }

  /** The types a session's agent may write through `ledger_append`. */
  get ledgerTypes(): readonly LedgerEntryType[] {
    return this.ledger.types;
  }

  /**
   * Settle a write tool's call: at once when the allow-list covers it, else
   * when the operator decides its card, or when the card is withdrawn
   * (the turn stopped, or `signal` aborted). `annex` goes on the card for
   * the operator to read before deciding.
   */
  request(
    sessionId: string,
    tool: BrokerCardTool,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    annex: CardAnnex = {},
  ): Promise<BrokerOutcome> {
    const kind = BROKER_TOOL_POLICY[tool].card;
    if (!kind) throw new Error(`${tool} raises no card`);
    const key = allowListKey(tool, input);
    if (key !== null && this.allowList().some((rule) => rule.tool === tool && rule.key === key)) {
      return Promise.resolve({ approved: true, decidedBy: "allow-list" });
    }
    const card: SidecarCard = {
      id: randomUUID(),
      sessionId,
      tool,
      kind,
      input,
      allowListKey: key,
      ...(annex.preview !== undefined && { preview: annex.preview }),
      ...(annex.runOptions !== undefined && { runOptions: annex.runOptions }),
      ...(annex.changeSet !== undefined && { changeSet: annex.changeSet }),
      ...(annex.runPlan !== undefined && { runPlan: annex.runPlan }),
      ...(annex.placement !== undefined && { placement: annex.placement }),
      ...(annex.link !== undefined && { link: annex.link }),
      ...(annex.externalCall !== undefined && { externalCall: annex.externalCall }),
      status: "pending",
      raisedAt: this.iso(),
    };
    return new Promise<BrokerOutcome>((resolve) => {
      const onAbort = (): void => { this.settle(card.id, "withdrawn", "The turn stopped before the card was decided"); };
      this.pending.set(card.id, {
        card,
        settle: (outcome) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(outcome);
        },
      });
      const cards = this.sessionCards.get(sessionId) ?? [];
      cards.push(card);
      this.sessionCards.set(sessionId, cards);
      this.onCard?.(card);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** The session's cards since the server started, oldest first. */
  cards(sessionId: string): SidecarCard[] {
    return (this.sessionCards.get(sessionId) ?? []).map((card) => ({ ...card }));
  }

  /**
   * Change-set cards whose items are not in the PRD yet: waiting on the
   * operator, or approved and still being written. The Plan tree draws
   * their items as ghost rows.
   */
  proposals(): SidecarCard[] {
    return [...this.sessionCards.values()].flat()
      .filter((card) => card.changeSet && (card.status === "pending" || (card.status === "approved" && !card.carriedOut)))
      .map((card) => ({ ...card }));
  }

  /**
   * Record how an approved call's effect ended, on the card and in its audit
   * trail, and announce it: a change-set card's ghost rows give way to the
   * items it wrote.
   */
  recordCarriedOut(sessionId: string, cardId: string, carriedOut: NonNullable<SidecarCard["carriedOut"]>): void {
    const card = this.sessionCards.get(sessionId)?.find((c) => c.id === cardId);
    if (!card || card.status !== "approved" || card.carriedOut) return;
    this.writeCarriedOut(card, carriedOut);
  }

  /**
   * A started effect that failed afterwards: a run hench ended in failure
   * after its tool result said it started. Only revises a success to a
   * failure, so a card never goes back to reading carried out.
   *
   * @param note What the agent is told on the session's next turn, since its
   *   tool result has already returned.
   */
  reviseCarriedOutFailed(sessionId: string, cardId: string, note?: string): void {
    const card = this.sessionCards.get(sessionId)?.find((c) => c.id === cardId);
    if (!card?.carriedOut?.ok) return;
    this.writeCarriedOut(card, { ...card.carriedOut, ok: false });
    if (note) this.turnNotes.set(sessionId, [...(this.turnNotes.get(sessionId) ?? []), note]);
  }

  /** What the session's next turn tells the agent, oldest first; kept until {@link notesDelivered}. */
  notesForNextTurn(sessionId: string): string[] {
    return [...(this.turnNotes.get(sessionId) ?? [])];
  }

  /** Drop the first `count` notes: a completed turn carried them. */
  notesDelivered(sessionId: string, count: number): void {
    const left = (this.turnNotes.get(sessionId) ?? []).slice(count);
    if (left.length > 0) this.turnNotes.set(sessionId, left);
    else this.turnNotes.delete(sessionId);
  }

  private writeCarriedOut(card: SidecarCard, carriedOut: NonNullable<SidecarCard["carriedOut"]>): void {
    card.carriedOut = carriedOut;
    ensureSidecarDir(this.dir);
    appendFileSync(join(this.dir, `${card.sessionId}.cards.jsonl`), JSON.stringify(card) + "\n", "utf-8");
    this.onCard?.({ ...card });
  }

  /** Decide the session's first undecided card. */
  decide(sessionId: string, cardId: string, decision: CardDecision): SidecarCard {
    const entry = this.pending.get(cardId);
    if (!entry || entry.card.sessionId !== sessionId) {
      const known = this.sessionCards.get(sessionId)?.some((card) => card.id === cardId);
      throw known
        ? new BrokerDecisionError(409, `Card ${cardId} is already settled`)
        : new BrokerDecisionError(404, `No card ${cardId} in Sidecar session ${sessionId}`);
    }
    const first = this.sessionCards.get(sessionId)?.find((card) => card.status === "pending");
    if (first && first.id !== cardId) {
      throw new BrokerDecisionError(409, `Cards are decided in order: decide card ${first.id} first`);
    }
    const { card } = entry;
    // Every refusal comes before anything is changed.
    let edited: SidecarChangeSet | undefined;
    if (decision.edits !== undefined) {
      if (!decision.approve) throw new BrokerDecisionError(409, "Only an approval carries edits");
      if (!card.changeSet) throw new BrokerDecisionError(409, `A ${card.kind} card takes no edits`);
      const applied = applyChangeSetEdits(card.changeSet, decision.edits);
      if (typeof applied === "string") throw new BrokerDecisionError(400, applied);
      edited = applied;
    }
    if (decision.placement !== undefined) {
      if (!decision.approve) throw new BrokerDecisionError(409, "Only an approval carries an edited placement");
      if (!card.placement) throw new BrokerDecisionError(409, `A ${card.kind} card takes no placement`);
      if (!decision.placement.check.ok) throw new BrokerDecisionError(400, "An edited placement rex refuses cannot be approved");
    }
    if (card.kind === "run-plan" && decision.approve) {
      const lanes = card.runPlan?.lanes.length ?? 0;
      if (decision.lane === undefined) throw new BrokerDecisionError(400, "A run-plan card is approved by choosing a lane to start");
      if (!Number.isInteger(decision.lane) || decision.lane < 0 || decision.lane >= lanes) {
        throw new BrokerDecisionError(400, `"lane" must be a lane of the plan (0 to ${lanes - 1})`);
      }
    } else if (decision.lane !== undefined) {
      throw new BrokerDecisionError(409, card.kind === "run-plan" ? "Only an approval chooses a lane" : `A ${card.kind} card takes no lane`);
    }
    let editedPath: string | undefined;
    if (decision.path !== undefined) {
      if (!decision.approve) throw new BrokerDecisionError(409, "Only an approval carries a path");
      if (card.kind !== "draft-file") throw new BrokerDecisionError(409, `A ${card.kind} card takes no path`);
      const resolved = resolveDraftPath(decision.path, this.draftsDirPath);
      if (!resolved.ok) throw new BrokerDecisionError(400, resolved.error);
      editedPath = resolved.path;
    }
    let editedArguments: Record<string, unknown> | undefined;
    if (decision.arguments !== undefined) {
      if (!decision.approve) throw new BrokerDecisionError(409, "Only an approval carries arguments");
      if (card.kind !== "external-call") throw new BrokerDecisionError(409, `A ${card.kind} card takes no arguments`);
      if (!isPlainObject(decision.arguments)) throw new BrokerDecisionError(400, `"arguments" must be an object`);
      const agent = isPlainObject(card.input.arguments) ? card.input.arguments : {};
      const next = { ...decision.arguments };
      // An idempotency key is the agent's: the form shows it read-only and approval cannot change it.
      for (const name of IDEMPOTENCY_KEY_PROPERTIES) {
        if (name in agent) next[name] = agent[name];
        else delete next[name];
      }
      if (!isDeepStrictEqual(next, agent)) editedArguments = next;
    }
    if (decision.remember) {
      if (!decision.approve) throw new BrokerDecisionError(409, "Only an approval can be remembered");
      if (card.allowListKey === null) {
        throw new BrokerDecisionError(409, `A ${card.tool} call can never be allow-listed`);
      }
      this.addRule({ tool: card.tool, key: card.allowListKey });
      card.remembered = true;
    }
    if (edited) {
      card.changeSet = edited;
      card.edited = true;
    }
    if (editedPath !== undefined && editedPath !== card.input.path) {
      card.input = { ...card.input, path: editedPath };
      card.edited = true;
    }
    if (decision.placement && card.placement) {
      card.placement = { ...card.placement, ...decision.placement };
      card.edited = true;
    }
    if (editedArguments) {
      card.input = { ...card.input, arguments: editedArguments };
      card.edited = true;
    }
    if (decision.lane !== undefined) card.lane = decision.lane;
    this.settle(cardId, decision.approve ? "approved" : "denied", decision.reason);
    return { ...card };
  }

  /**
   * The signal a decided call carries out its effect under: it aborts when
   * `signal` does or when the session is withdrawn (the turn stopped or
   * ended). Call `release` once the effect has answered.
   */
  carryOutSignal(sessionId: string, signal?: AbortSignal): { signal: AbortSignal; release: () => void } {
    const controller = new AbortController();
    const calls = this.carrying.get(sessionId) ?? new Set<AbortController>();
    calls.add(controller);
    this.carrying.set(sessionId, calls);
    const onAbort = (): void => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    return {
      signal: controller.signal,
      release: () => {
        signal?.removeEventListener("abort", onAbort);
        calls.delete(controller);
        if (calls.size === 0) this.carrying.delete(sessionId);
      },
    };
  }

  /** Withdraw every pending card of a session and abort its calls still carrying out; returns how many cards. */
  withdraw(sessionId: string, reason: string): number {
    for (const controller of this.carrying.get(sessionId) ?? []) controller.abort();
    let count = 0;
    for (const { card } of [...this.pending.values()]) {
      if (card.sessionId !== sessionId) continue;
      this.settle(card.id, "withdrawn", reason);
      count += 1;
    }
    return count;
  }

  allowList(): AllowListRule[] {
    const path = join(this.dir, `${ALLOW_LIST_NAME}.json`);
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as { schema?: unknown; rules?: unknown };
    if (parsed.schema !== ALLOW_LIST_SCHEMA || !Array.isArray(parsed.rules)) {
      throw new Error(`${path} is not a Sidecar allow-list (schema ${String(parsed.schema)})`);
    }
    // A rule for a call that can never be allow-listed is ignored however it
    // got into the file, so a hand edit cannot let work or a post through.
    return parsed.rules.filter((rule): rule is AllowListRule => {
      const r = rule as Partial<AllowListRule> | null;
      return !!r && typeof r.tool === "string" && isBrokerTool(r.tool) && typeof r.key === "string"
        && BROKER_TOOL_POLICY[r.tool].allowList === "per-call"
        && allowListKey(r.tool, ruleInput(r.key)) === r.key;
    });
  }

  /**
   * Add the rule covering a call, as the operator does from the settings
   * editor. Refused for a call that can never be allow-listed (work, reset,
   * push, writes); returns the rule, which is already on the list if it was.
   */
  allow(tool: BrokerCardTool, input: Record<string, unknown>): AllowListRule {
    const rule = this.checkAllow(tool, input);
    this.addRule(rule);
    return rule;
  }

  /** The rule {@link allow} would add, or the same refusal; writes nothing. */
  checkAllow(tool: BrokerCardTool, input: Record<string, unknown>): AllowListRule {
    const key = allowListKey(tool, input);
    if (key === null) throw new BrokerDecisionError(409, `A ${tool} call like this can never be allow-listed`);
    return { tool, key };
  }

  /** Remove a rule; true when it was on the list. */
  revoke(rule: AllowListRule): boolean {
    const rules = this.allowList();
    const kept = rules.filter((r) => r.tool !== rule.tool || r.key !== rule.key);
    if (kept.length === rules.length) return false;
    this.writeAllowList(kept);
    return true;
  }

  /**
   * The agent's `ledger_append`: a typed entry in the session's ledger.
   * Raises no card, since the ledger is the session's own; throws on a type
   * this scope's agent may not write.
   */
  appendLedger(sessionId: string, type: LedgerEntryType, text: string): LedgerEntry {
    if (!this.ledger.types.includes(type)) throw new Error(`A ${type} ledger entry is not one this session writes`);
    return this.writeLedger(sessionId, type, text);
  }

  /** The hub's drill-down: a `handoff` entry naming the hub's question, which no agent can write. */
  appendHandoff(sessionId: string, text: string): LedgerEntry {
    return this.writeLedger(sessionId, "handoff", text);
  }

  private writeLedger(sessionId: string, type: LedgerEntryType, text: string): LedgerEntry {
    const entry: LedgerEntry = { at: this.iso(), type, text };
    ensureSidecarDir(this.dir);
    appendLedgerEntryAt(this.ledger.path(sessionId), entry);
    return entry;
  }

  private settle(cardId: string, status: Exclude<SidecarCardStatus, "pending">, reason?: string): void {
    const entry = this.pending.get(cardId);
    if (!entry) return;
    this.pending.delete(cardId);
    const { card } = entry;
    card.status = status;
    card.decidedAt = this.iso();
    if (reason) card.reason = reason;
    ensureSidecarDir(this.dir);
    appendFileSync(join(this.dir, `${card.sessionId}.cards.jsonl`), JSON.stringify(card) + "\n", "utf-8");
    this.onCard?.({ ...card });
    entry.settle({
      approved: status === "approved",
      decidedBy: status === "withdrawn" ? "withdrawn" : "operator",
      card: { ...card },
    });
  }

  private addRule(rule: AllowListRule): void {
    const rules = this.allowList();
    if (rules.some((r) => r.tool === rule.tool && r.key === rule.key)) return;
    this.writeAllowList([...rules, rule]);
  }

  private writeAllowList(rules: AllowListRule[]): void {
    ensureSidecarDir(this.dir);
    writeRunFileAtomic(this.dir, ALLOW_LIST_NAME, { schema: ALLOW_LIST_SCHEMA, rules });
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }
}

/**
 * The call a rule key stands for: a bare argv, or a hub rule's `{ project, argv }`.
 * A key that is not JSON stands for no call, which {@link allowListKey} then rejects.
 */
function ruleInput(key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(key);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { argv: parsed };
  } catch {
    return { argv: undefined };
  }
}
