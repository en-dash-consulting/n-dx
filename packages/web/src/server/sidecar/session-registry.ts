/**
 * The dashboard server's Sidecar session registry.
 *
 * A Sidecar session is a conversation with a vendor CLI held across turns.
 * Each turn is one CLI spawn that resumes the vendor's own session id (see
 * `startVendorSession` in `@n-dx/llm-client`), so the only state that must
 * outlive the server is that id. The registry keeps it, with the session's
 * name, vendor, model, lens, turn count, tokens and transcript cursor, in
 * `<henchDir>/sidecar/index.json`, and each session's transcript as JSONL
 * frames beside it (`<id>.jsonl`). A restarted server reads the index and the
 * next turn resumes the stored id.
 *
 * **No idle processes, so idling is forgetting.** A session idle longer than
 * the TTL (default 2 h) loses its resume id; the record and transcript stay,
 * and its next turn starts a fresh vendor session. There is no timer: reads
 * (`list`, `get`) apply the TTL in memory and never write, so a GET stays
 * read-only; the writing paths (`sendTurn`) persist the forgetting.
 *
 * **Machine-local.** The directory carries its own `.gitignore` (`*`), so a
 * project with no ignore line for it still never commits a transcript.
 *
 * Sessions are keyed by `(scope, worktree, id)`: `worktree` is the checkout a
 * session runs in, `scope` is `worktree` or `hub`.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, truncateSync } from "node:fs";
import { join } from "node:path";
import { addTokenUsage, resolveLayout, resumeVendorSession, startVendorSession } from "@n-dx/llm-client";
import type {
  RuntimeEvent,
  SessionTurnResult,
  SessionTurnStatus,
  TokenUsage,
  VendorSession,
  VendorSessionOptions,
} from "@n-dx/llm-client";
import { writeRunFileAtomic } from "../run-end.js";
import {
  CHECKPOINT_PROMPT,
  COLD_EXCHANGES,
  composeColdPrompt,
  composeOpeningPrompt,
  contextTokens,
  type Exchange,
  type SidecarScope,
} from "./context-refresh.js";
import { renderLedger, type LedgerEntry } from "./ledger.js";
import type { PacketTarget } from "./packet-builders.js";
import { resolveSidecarSessionEnv } from "./session-env.js";
import { ensureSidecarDir } from "./sidecar-dir.js";
import { sidecarSpawnFlags, writeBrokerMcpConfig, type SidecarBrokerEndpoint } from "./spawn-policy.js";

/** Idle time after which a session forgets its resume id. */
export const DEFAULT_SIDECAR_TTL_MS = 2 * 60 * 60 * 1000;

export type { SidecarScope };

export interface SidecarSessionRecord {
  id: string;
  scope: SidecarScope;
  /** Absolute path of the checkout the session runs in. */
  worktree: string;
  name: string;
  vendor: string;
  model?: string;
  lens?: string;
  /** What the lens is pointed at (an item id, display id or alias); absent means no target. */
  target?: PacketTarget;
  /**
   * The next turn carries the packet even though it resumes: the lens or
   * target changed, or the turn that carried it did not complete. A turn
   * that opens a vendor session always carries it.
   */
  packetDue?: true;
  /** Vendor session id the next turn resumes; absent before the first turn and after the TTL. */
  resumeId?: string;
  /** Sequence number of the last transcript frame. */
  cursor: number;
  turns: number;
  tokens: TokenUsage;
  createdAt: string;
  lastActivityAt: string;
  endedAt?: string;
  /**
   * Set when a turn ended above the context ceiling: the next turn starts a
   * cold vendor session instead of resuming. Cleared once that turn completes.
   */
  refresh?: { contextTokens: number; ceiling: number };
}

/** One transcript line. */
export type SidecarFrame =
  | { seq: number; at: string; type: "user"; text: string }
  /** `checkpoint` marks an event of the ledger-writing turn, which is not part of the conversation. */
  | { seq: number; at: string; type: "event"; event: RuntimeEvent; checkpoint?: true }
  /** A cold session began: the context was refreshed, carrying `notes` ledger entries. */
  | { seq: number; at: string; type: "context-refreshed"; notes: number; contextTokens: number };

export interface CreateSidecarSessionInput {
  scope: SidecarScope;
  worktree: string;
  vendor: string;
  model?: string;
  name?: string;
  lens?: string;
  target?: PacketTarget;
}

/** The fields {@link SidecarSessionRegistry.update} can change. */
export interface UpdateSidecarSessionInput {
  name?: string;
  lens?: string;
  target?: PacketTarget;
}

/** Session options the registry does not own: env policy, LLM config, binary. */
export type SidecarSessionConnect = (
  record: SidecarSessionRecord,
) => Omit<VendorSessionOptions, "vendor" | "cwd" | "model">;

/** What a session needs to checkpoint at its context ceiling and start cold. */
export interface SidecarContextOptions {
  /** Tokens of context above which a turn checkpoints. */
  ceiling: (record: SidecarSessionRecord) => number;
  /** The session's ledger, oldest first. */
  ledger: (record: SidecarSessionRecord) => LedgerEntry[];
  /** The lens packet rebuilt fresh; `undefined` for a lens that sends none. */
  packet?: (record: SidecarSessionRecord) => Promise<string | undefined>;
}

/** What one finished turn spent, checkpoint included. */
export interface SidecarTurnSpend {
  /** The session as the turn started, so a lens changed mid-turn is not credited with its spend. */
  record: SidecarSessionRecord;
  status: SessionTurnStatus;
  tokens: TokenUsage;
}

export interface SidecarRegistryOptions {
  /** Called once per finished turn, after its tokens are added to the session. */
  onTurnSpend?: (spend: SidecarTurnSpend) => void;
  /** Directory holding `index.json` and the transcripts. */
  dir: string;
  /** Per-session options; called each time a vendor session is opened. */
  connect: SidecarSessionConnect;
  /** Without it a session never checkpoints. */
  context?: SidecarContextOptions;
  ttlMs?: number;
  now?: () => number;
}

interface IndexFile {
  schema: typeof INDEX_SCHEMA;
  sessions: SidecarSessionRecord[];
}

export interface WorktreeSidecarRegistryOptions extends Pick<SidecarRegistryOptions, "ttlMs" | "now" | "context" | "onTurnSpend"> {
  /** Where a session reaches the `ndx-sidecar` broker; absent gives it no MCP server at all. */
  broker?: (sessionId: string) => SidecarBrokerEndpoint | undefined;
}

/** The directory holding a worktree's Sidecar index, transcripts, cards and allow-list. */
export function worktreeSidecarDir(projectDir: string): string {
  return join(resolveLayout(projectDir).henchDir, "sidecar");
}

/**
 * The worktree-scope registry for `projectDir`: `<henchDir>/sidecar/`, each
 * session's vendor CLI given the project's guard.env-filtered environment
 * (never the server's full `process.env`) — see `session-env.ts` — and spawned
 * read-only with the broker as its only MCP server — see `spawn-policy.ts`.
 */
export function createWorktreeSidecarRegistry(
  projectDir: string,
  opts: WorktreeSidecarRegistryOptions = {},
): SidecarSessionRegistry {
  const { broker, ...rest } = opts;
  const dir = worktreeSidecarDir(projectDir);
  return new SidecarSessionRegistry({ ...rest, dir, connect: sidecarSessionConnect(dir, broker) });
}

/**
 * What every Sidecar session's vendor CLI is opened with: the filtered
 * environment, the read-only spawn flags and a fresh MCP config naming only
 * the broker.
 */
export function sidecarSessionConnect(
  dir: string,
  broker?: WorktreeSidecarRegistryOptions["broker"],
): SidecarSessionConnect {
  return (record) => ({
    ...resolveSidecarSessionEnv(record.worktree),
    ...sidecarSpawnFlags(writeBrokerMcpConfig(dir, record.id, broker?.(record.id))),
  });
}

/** An open vendor session, and where its running turn's events go. */
interface LiveSession {
  session: VendorSession;
  sink?: (event: RuntimeEvent) => void;
}

const INDEX_SCHEMA = "ndx/sidecar-index/v1";
const INDEX_NAME = "index";

function isRecord(value: unknown): value is SidecarSessionRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return typeof r.id === "string" && /^[\w-]+$/.test(r.id)
    && (r.scope === "worktree" || r.scope === "hub")
    && typeof r.worktree === "string" && typeof r.vendor === "string"
    && typeof r.lastActivityAt === "string";
}

export class SidecarSessionRegistry {
  private readonly dir: string;
  private readonly connect: SidecarSessionConnect;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly context?: SidecarContextOptions;
  private readonly onTurnSpend?: (spend: SidecarTurnSpend) => void;
  /** Sessions with a turn in progress, from the moment `sendTurn` is called until it settles. */
  private readonly turnOpen = new Set<string>();
  /** Open turns the operator stopped before their vendor call began (a cold turn building its packet). */
  private readonly stopRequested = new Set<string>();
  private readonly records = new Map<string, SidecarSessionRecord>();
  private readonly live = new Map<string, LiveSession>();
  /** Sessions whose cursor has been checked against the transcript; see {@link reconcileCursor}. */
  private readonly reconciled = new Set<string>();

  constructor(opts: SidecarRegistryOptions) {
    this.dir = opts.dir;
    this.connect = opts.connect;
    this.ttlMs = opts.ttlMs ?? DEFAULT_SIDECAR_TTL_MS;
    this.now = opts.now ?? Date.now;
    this.context = opts.context;
    this.onTurnSpend = opts.onTurnSpend;
    for (const record of this.readIndex()) this.records.set(record.id, record);
  }

  create(input: CreateSidecarSessionInput): SidecarSessionRecord {
    const at = this.iso();
    const record: SidecarSessionRecord = {
      id: randomUUID(),
      scope: input.scope,
      worktree: input.worktree,
      name: input.name ?? "Sidecar",
      vendor: input.vendor,
      ...(input.model && { model: input.model }),
      ...(input.lens && { lens: input.lens }),
      ...(input.target && { target: { ...input.target } }),
      cursor: 0,
      turns: 0,
      tokens: { input: 0, output: 0 },
      createdAt: at,
      lastActivityAt: at,
    };
    this.records.set(record.id, record);
    this.persist();
    return { ...record };
  }

  /**
   * Rename a session, point it at another lens or target, or both. A new lens
   * or target makes the next turn carry its packet, even one made mid-turn.
   * Returns undefined for an unknown session.
   */
  update(id: string, input: UpdateSidecarSessionInput): SidecarSessionRecord | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    if (input.name !== undefined) record.name = input.name;
    const lensChanged = input.lens !== undefined && input.lens !== record.lens;
    const targetChanged = input.target !== undefined && input.target.ref !== record.target?.ref;
    if (input.lens !== undefined) record.lens = input.lens;
    if (input.target !== undefined) record.target = { ...input.target };
    if (lensChanged || targetChanged) record.packetDue = true;
    this.persist();
    return this.view(record);
  }

  list(filter: { scope?: SidecarScope; worktree?: string } = {}): SidecarSessionRecord[] {
    return [...this.records.values()]
      .filter((r) => (!filter.scope || r.scope === filter.scope)
        && (!filter.worktree || r.worktree === filter.worktree))
      .map((r) => this.view(r));
  }

  get(id: string): SidecarSessionRecord | undefined {
    const record = this.records.get(id);
    return record && this.view(record);
  }

  /**
   * Run one turn: open (or resume) the vendor session, append the prompt and
   * every event to the transcript, and store the id the turn reported.
   */
  async sendTurn(id: string, prompt: string, onFrame?: (frame: SidecarFrame) => void): Promise<SessionTurnResult> {
    this.sweep();
    const record = this.records.get(id);
    if (!record) throw new Error(`No Sidecar session ${id}`);
    if (record.endedAt) throw new Error(`Sidecar session ${id} has ended`);
    if (this.turnOpen.has(id)) throw new Error(`A turn is already running in Sidecar session ${id}`);
    this.turnOpen.add(id);
    try {
      return await this.runTurn(record, prompt, onFrame);
    } finally {
      this.turnOpen.delete(id);
      this.stopRequested.delete(id);
    }
  }

  private async runTurn(
    record: SidecarSessionRecord,
    prompt: string,
    onFrame?: (frame: SidecarFrame) => void,
  ): Promise<SessionTurnResult> {
    // A checkpointed session never resumes: its next turn is a new vendor session.
    const context = this.context;
    const cold = !!context && record.refresh !== undefined;
    if (cold) {
      this.live.delete(record.id);
      delete record.resumeId;
    }
    // A turn that opens a vendor session (the first, or after a restart without
    // a resume id or the TTL) knows nothing yet, so it carries the packet.
    const fresh = !this.live.has(record.id) && !record.resumeId;
    const live = this.liveSession(record);

    this.reconcileCursor(record);
    // The packet opens a fresh vendor session and the turn after a lens or
    // target change; a refreshed turn carries it in its cold prompt.
    const opening = !cold && !!context?.packet && (fresh || record.packetDue === true);
    // Consumed now, so a lens or target change made while this turn runs
    // stays due for the next one; restored below unless the turn completes.
    let delivered = false;
    if (opening || cold) delete record.packetDue;
    const exchanges = cold ? this.lastExchanges(record.id) : [];
    const append = (frame: SidecarFrame): void => {
      this.appendFrame(record, frame);
      onFrame?.(frame);
    };
    record.lastActivityAt = this.iso();
    append({ seq: record.cursor + 1, at: record.lastActivityAt, type: "user", text: prompt });
    this.persist();

    try {
      let vendorPrompt = prompt;
      if (cold && context && record.refresh) {
        const packet = await context.packet?.(record);
        const ledger = renderLedger(context.ledger(record));
        append({
          seq: record.cursor + 1,
          at: this.iso(),
          type: "context-refreshed",
          notes: ledger.carried,
          contextTokens: record.refresh.contextTokens,
        });
        vendorPrompt = composeColdPrompt({ packet, ledger: ledger.text, exchanges, prompt });
        // Stopped while the packet was built: settle without spawning. The
        // session stays marked, so its next turn starts cold again.
        if (this.stopRequested.has(record.id)) {
          return { turn: live.session.turns, status: "interrupted", events: [], tokenUsage: { input: 0, output: 0 }, exitCode: null };
        }
      }

      if (opening) {
        const packet = await context?.packet?.(record);
        if (packet) vendorPrompt = composeOpeningPrompt({ packet, prompt });
        if (this.stopRequested.has(record.id)) {
          return { turn: live.session.turns, status: "interrupted", events: [], tokenUsage: { input: 0, output: 0 }, exitCode: null };
        }
      }

      // The context the turn ended with: what its last call sent in.
      let ended = 0;
      live.sink = (event) => {
        if (event.type === "token_usage" && event.tokenUsage) ended = contextTokens(event.tokenUsage);
        append({ seq: record.cursor + 1, at: this.iso(), type: "event", event });
      };
      const before = record.tokens;
      // The session as the turn ran: a lens changed mid-turn applies to the next one.
      const ranAs = { ...record };
      const result = await live.session.sendTurn(vendorPrompt);
      record.turns += 1;
      record.tokens = addTokenUsage(record.tokens, result.tokenUsage);
      if (result.sessionId) record.resumeId = result.sessionId;
      if (cold && result.status === "completed") delete record.refresh;
      delivered = result.status === "completed";
      if (context && result.status === "completed") {
        const ceiling = context.ceiling(record);
        if (ended > ceiling) await this.checkpoint(record, live, { contextTokens: ended, ceiling }, append);
      }
      this.onTurnSpend?.({ record: ranAs, status: result.status, tokens: subtractTokenUsage(record.tokens, before) });
      return result;
    } finally {
      // An opening turn that failed or was stopped may never have reached
      // the model: the next turn carries the packet again.
      if (opening && !delivered) record.packetDue = true;
      live.sink = undefined;
      record.lastActivityAt = this.iso();
      this.persist();
    }
  }

  /**
   * Ask the agent to write its ledger, and mark the session so its next turn
   * starts cold. The mark comes first: a server that stops mid-checkpoint
   * still refreshes the context instead of resuming an oversized one.
   */
  private async checkpoint(
    record: SidecarSessionRecord,
    live: LiveSession,
    measured: { contextTokens: number; ceiling: number },
    append: (frame: SidecarFrame) => void,
  ): Promise<void> {
    record.refresh = measured;
    this.persist();
    live.sink = (event) => append({ seq: record.cursor + 1, at: this.iso(), type: "event", event, checkpoint: true });
    const result = await live.session.sendTurn(CHECKPOINT_PROMPT);
    record.tokens = addTokenUsage(record.tokens, result.tokenUsage);
  }

  /**
   * The last {@link COLD_EXCHANGES} exchanges of the transcript, verbatim: each
   * user message with the assistant text that answered it. The checkpoint
   * turn's events are not part of the conversation.
   */
  private lastExchanges(id: string): Exchange[] {
    const exchanges: Exchange[] = [];
    for (const frame of this.readFrames(id)) {
      if (frame.type === "user") {
        exchanges.push({ user: frame.text, assistant: "" });
      } else if (frame.type === "event" && !frame.checkpoint && frame.event.type === "assistant" && frame.event.text) {
        const current = exchanges.at(-1);
        if (current) current.assistant = current.assistant ? `${current.assistant}\n\n${frame.event.text}` : frame.event.text;
      }
    }
    return exchanges.slice(-COLD_EXCHANGES);
  }

  /**
   * Transcript frames after `cursor`, in order. Every frame is written with a
   * trailing newline, so a final line without one is a crash mid-append and is
   * skipped; a malformed line anywhere else is real corruption and throws.
   */
  readFrames(id: string, after = 0): SidecarFrame[] {
    if (!this.records.has(id)) throw new Error(`No Sidecar session ${id}`);
    const path = this.transcriptPath(id);
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, "utf-8").split("\n");
    lines.pop(); // "" after a clean final newline, else the partial fragment
    const frames: SidecarFrame[] = [];
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      try {
        frames.push(JSON.parse(line) as SidecarFrame);
      } catch (error) {
        throw new Error(`${path} line ${index + 1} is not a JSON frame: ${(error as Error).message}`);
      }
    }
    return frames.filter((frame) => frame.seq > after);
  }

  /** Whether a turn is running in the session now. */
  isRunning(id: string): boolean {
    return this.turnOpen.has(id);
  }

  /**
   * Stop the running turn; the session stays usable and its next turn
   * resumes. The turn settles as `interrupted`.
   *
   * @returns false when no turn was running.
   */
  async interrupt(id: string): Promise<boolean> {
    if (!this.isRunning(id)) return false;
    const session = this.live.get(id)?.session;
    // A turn still before its vendor call has nothing to signal yet; it checks this before spawning.
    if (session?.state === "running") await session.interrupt();
    else this.stopRequested.add(id);
    return true;
  }

  /** Stop any running turn; the session keeps its record and transcript but never resumes. */
  async end(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record || record.endedAt) return;
    await this.live.get(id)?.session.end();
    this.live.delete(id);
    record.endedAt = this.iso();
    delete record.resumeId;
    this.persist();
  }

  /** Whether the record holds a resume id its idle time has already forfeited. */
  private expired(record: SidecarSessionRecord): boolean {
    return !!record.resumeId
      && this.live.get(record.id)?.session.state !== "running"
      && Date.parse(record.lastActivityAt) <= this.now() - this.ttlMs;
  }

  /** A copy of the record as a reader sees it: the TTL applied, nothing written. */
  private view(record: SidecarSessionRecord): SidecarSessionRecord {
    const copy = { ...record };
    if (this.expired(record)) delete copy.resumeId;
    return copy;
  }

  /** Forget the resume id of every session idle longer than the TTL, and persist that. */
  sweep(): void {
    let changed = false;
    for (const record of this.records.values()) {
      if (!this.expired(record)) continue;
      delete record.resumeId;
      this.live.delete(record.id);
      changed = true;
    }
    if (changed) this.persist();
  }

  /** The open vendor session, resuming the stored id when there is none — after a restart or the TTL. */
  private liveSession(record: SidecarSessionRecord): LiveSession {
    const existing = this.live.get(record.id);
    if (existing) return existing;
    const options: VendorSessionOptions = {
      ...this.connect(record),
      vendor: record.vendor,
      cwd: record.worktree,
      ...(record.model && { model: record.model }),
      onEvent: (event) => entry.sink?.(event),
    };
    const entry: LiveSession = {
      session: record.resumeId
        ? resumeVendorSession(record.resumeId, options)
        : startVendorSession(options),
    };
    this.live.set(record.id, entry);
    return entry;
  }

  /**
   * Event frames reach the transcript before the index is saved, so a server
   * that stopped mid-turn left the index cursor behind the transcript. Take
   * the cursor from the transcript once per session per registry, or the next
   * turn would reuse sequence numbers a client already fetched past.
   */
  private reconcileCursor(record: SidecarSessionRecord): void {
    if (this.reconciled.has(record.id)) return;
    this.dropPartialTail(record.id);
    const last = this.readFrames(record.id, record.cursor).at(-1);
    if (last) record.cursor = last.seq;
    this.reconciled.add(record.id);
  }

  /**
   * A server killed mid-append leaves a last line without its newline; the next
   * append would glue a frame onto it. Move the fragment to `<id>.jsonl.corrupt`
   * and cut it from the transcript.
   */
  private dropPartialTail(id: string): void {
    const path = this.transcriptPath(id);
    if (!existsSync(path)) return;
    const bytes = readFileSync(path);
    if (bytes.length === 0 || bytes[bytes.length - 1] === 0x0a) return;
    const keep = bytes.lastIndexOf(0x0a) + 1;
    appendFileSync(`${path}.corrupt`, Buffer.concat([bytes.subarray(keep), Buffer.from("\n")]));
    truncateSync(path, keep);
  }

  private appendFrame(record: SidecarSessionRecord, frame: SidecarFrame): void {
    ensureSidecarDir(this.dir);
    appendFileSync(this.transcriptPath(record.id), JSON.stringify(frame) + "\n", "utf-8");
    record.cursor = frame.seq;
  }

  private transcriptPath(id: string): string {
    return join(this.dir, `${id}.jsonl`);
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private persist(): void {
    ensureSidecarDir(this.dir);
    const index: IndexFile = { schema: INDEX_SCHEMA, sessions: [...this.records.values()] };
    writeRunFileAtomic(this.dir, INDEX_NAME, index as unknown as Record<string, unknown>);
  }

  private readIndex(): SidecarSessionRecord[] {
    const path = join(this.dir, `${INDEX_NAME}.json`);
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<IndexFile>;
    if (parsed.schema !== INDEX_SCHEMA || !Array.isArray(parsed.sessions)) {
      throw new Error(`${path} is not a Sidecar session index (schema ${String(parsed.schema)})`);
    }
    return parsed.sessions.filter(isRecord);
  }
}


/** `after` minus `before`, field by field; both are running totals of the same session. */
function subtractTokenUsage(after: TokenUsage, before: TokenUsage): TokenUsage {
  const out: TokenUsage = { input: after.input - before.input, output: after.output - before.output };
  const cacheCreationInput = (after.cacheCreationInput ?? 0) - (before.cacheCreationInput ?? 0);
  const cacheReadInput = (after.cacheReadInput ?? 0) - (before.cacheReadInput ?? 0);
  if (cacheCreationInput) out.cacheCreationInput = cacheCreationInput;
  if (cacheReadInput) out.cacheReadInput = cacheReadInput;
  return out;
}
