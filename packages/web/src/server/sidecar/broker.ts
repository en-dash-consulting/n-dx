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
import { writeRunFileAtomic } from "../run-end.js";
import {
  allowListKey,
  BROKER_TOOL_POLICY,
  isBrokerTool,
  type AllowListRule,
  type BrokerToolName,
  type SidecarCardKind,
} from "./broker-policy.js";
import { appendLedgerEntry, type LedgerEntry, type LedgerEntryType } from "./ledger.js";
import { ensureSidecarDir } from "./sidecar-dir.js";

export type SidecarCardStatus = "pending" | "approved" | "denied" | "withdrawn";

export interface SidecarCard {
  id: string;
  sessionId: string;
  tool: BrokerToolName;
  kind: SidecarCardKind;
  input: Record<string, unknown>;
  /** The rule "always allow" would add; `null` when the call can never be allow-listed. */
  allowListKey: string | null;
  /** What the call would do, read before the card was raised: a work card's `ndx work --resolve`. */
  preview?: string;
  status: SidecarCardStatus;
  raisedAt: string;
  decidedAt?: string;
  /** The operator's note on a decision, or why a card was withdrawn. */
  reason?: string;
  /** Approved with "always allow": its rule went onto the allow-list. */
  remembered?: true;
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
}

/** A refused decision; `status` is the HTTP status a route answers with. */
export class BrokerDecisionError extends Error {
  constructor(readonly status: 404 | 409, message: string) {
    super(message);
  }
}

export interface SidecarBrokerOptions {
  /** The Sidecar directory: the allow-list, card audit and ledgers. */
  dir: string;
  /** Called when a card is raised or settled. */
  onCard?: (card: SidecarCard) => void;
  now?: () => number;
}

interface PendingCard {
  card: SidecarCard;
  settle: (outcome: BrokerOutcome) => void;
}

const ALLOW_LIST_SCHEMA = "ndx/sidecar-allow-list/v1";
const ALLOW_LIST_NAME = "allow-list";

export class SidecarBroker {
  private readonly dir: string;
  private readonly onCard?: (card: SidecarCard) => void;
  private readonly now: () => number;
  /** Every card raised since the server started, per session, oldest first. */
  private readonly sessionCards = new Map<string, SidecarCard[]>();
  private readonly pending = new Map<string, PendingCard>();
  /** Per session, the decided calls still carrying out their effect; `withdraw` aborts them. */
  private readonly carrying = new Map<string, Set<AbortController>>();

  constructor(opts: SidecarBrokerOptions) {
    this.dir = opts.dir;
    this.onCard = opts.onCard;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Settle a write tool's call: at once when the allow-list covers it, else
   * when the operator decides its card, or when the card is withdrawn
   * (the turn stopped, or `signal` aborted). `preview` goes on the card for
   * the operator to read before deciding.
   */
  request(
    sessionId: string,
    tool: BrokerToolName,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    preview?: string,
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
      ...(preview !== undefined && { preview }),
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
    if (decision.remember) {
      if (!decision.approve) throw new BrokerDecisionError(409, "Only an approval can be remembered");
      if (card.allowListKey === null) {
        throw new BrokerDecisionError(409, `A ${card.tool} call can never be allow-listed`);
      }
      this.addRule({ tool: card.tool, key: card.allowListKey });
      card.remembered = true;
    }
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
        && BROKER_TOOL_POLICY[r.tool].allowList !== "never"
        && (r.tool !== "run_command" || allowListKey("run_command", { argv: parseArgv(r.key) }) === r.key);
    });
  }

  /** Remove a rule; true when it was on the list. */
  revoke(rule: AllowListRule): boolean {
    const rules = this.allowList();
    const kept = rules.filter((r) => r.tool !== rule.tool || r.key !== rule.key);
    if (kept.length === rules.length) return false;
    this.writeAllowList(kept);
    return true;
  }

  /** Append a typed entry to the session's ledger. Raises no card: the ledger is session-local. */
  appendLedger(sessionId: string, type: LedgerEntryType, text: string): LedgerEntry {
    const entry: LedgerEntry = { at: this.iso(), type, text };
    appendLedgerEntry(this.dir, sessionId, entry);
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

/** A rule key's argv; `undefined` for a key that is not JSON, which {@link allowListKey} then rejects. */
function parseArgv(key: string): unknown {
  try {
    return JSON.parse(key);
  } catch {
    return undefined;
  }
}
