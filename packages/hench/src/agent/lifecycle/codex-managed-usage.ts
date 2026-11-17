import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveTranscriptPath } from "../../store/session-usage.js";
import { parseCodexUsage } from "../../store/codex-session-usage.js";
import type { TokenUsage } from "../../schema/index.js";
import type { RuntimeEvent } from "../../prd/llm-gateway.js";

const zero = (): Required<TokenUsage> => ({ input: 0, output: 0, cacheReadInput: 0, cacheCreationInput: 0 });
const keys = ["input", "output", "cacheReadInput", "cacheCreationInput"] as const;

function managedTranscriptPath(session: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  // Supply an explicit home so assisted discovery cannot fall back to the
  // parent's CODEX_HOME after guard.env removed it from the selected child.
  return resolveTranscriptPath(session, { vendor: "codex",
    codexHome: env.CODEX_HOME ?? join(env.HOME ?? env.USERPROFILE ?? homedir(), ".codex") });
}

/** A spawn-local boundary: never infer ownership from timestamps or another session. */
export class CodexManagedUsage {
  private session?: string;
  private observed = false;
  private invalid = false;
  private partial = false;
  private outputBoundary: number | undefined;
  private readonly seen = new Set<string>();
  private readonly seenPartialOutputs = new Set<number>();
  readonly notes: string[] = [];
  constructor(private previous: Required<TokenUsage> | undefined = zero(), private readonly expected?: string) {
    this.outputBoundary = previous?.output;
  }

  static async start(session: string | undefined, env: NodeJS.ProcessEnv, fork = false): Promise<CodexManagedUsage> {
    if (!session) return new CodexManagedUsage();
    const path = await managedTranscriptPath(session, env);
    if (path) {
      try {
        const parsed = parseCodexUsage(await readFile(path, "utf8"));
        if (parsed.sessionId === session && parsed.status === "complete") return new CodexManagedUsage(parsed.totals, fork ? undefined : session);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        // An unreadable boundary is unknown, never a zero starting balance.
      }
    }
    const tracker = new CodexManagedUsage(undefined, fork ? undefined : session);
    tracker.previous = undefined;
    tracker.outputBoundary = undefined;
    tracker.notes.push("Codex resumed usage baseline unavailable; first observation establishes a boundary without charging history.");
    tracker.partial = true;
    return tracker;
  }

  async finish(env: NodeJS.ProcessEnv, turn: number): Promise<RuntimeEvent | null> {
    if (this.observed && !this.invalid) return null;
    // Failed/killed processes may leave measured spend only in the rollout.
    if (this.session && !this.invalid) {
      const path = await managedTranscriptPath(this.session, env);
      if (path) {
        try {
          const parsed = parseCodexUsage(await readFile(path, "utf8"));
          if (parsed.sessionId === this.session && parsed.status === "complete") {
            const u = parsed.totals;
            this.notes.push("Codex failure usage recovered from cumulative rollout counters.");
            return this.observe({ type: "turn.failed", usage: {
              input_tokens: u.input + u.cacheReadInput + u.cacheCreationInput,
              output_tokens: u.output, cached_input_tokens: u.cacheReadInput, cache_write_input_tokens: u.cacheCreationInput,
            } }, turn);
          }
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          this.notes.push("Codex terminal rollout unavailable: " + error.name);
        }
      }
    }
    return this.observe({ type: "turn.failed" }, turn);
  }

  observe(raw: Record<string, unknown>, turn: number): RuntimeEvent | null {
    if (raw.type === "turn.started" || raw.type === "error") this.observed = false;
    if (raw.type === "thread.started" && typeof raw.thread_id === "string") {
      if ((this.expected && raw.thread_id !== this.expected) || (this.session && raw.thread_id !== this.session)) {
        this.invalid = true;
        this.notes.push("Codex usage session identity mismatch.");
      }
      this.session = raw.thread_id;
    }
    if (raw.type !== "turn.completed" && raw.type !== "turn.failed") return null;
    const u = raw.usage as Record<string, unknown> | undefined;
    const valid = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
    let usage = zero();
    let completeObservation = false;
    let status: "complete" | "partial" | "unavailable" = this.partial ? "partial" : "complete";
    if (this.session && !this.invalid && u && valid(u.output_tokens) &&
        (!valid(u.input_tokens) || !valid(u.cached_input_tokens))) {
      // Output is independently measured. Do not label inclusive input as
      // fresh spend when its cache split is absent. Retain the input boundary
      // so a later complete snapshot can recover that uncharged portion.
      // A replay of an already observed partial counter is not a reset.
      if (this.seenPartialOutputs.has(u.output_tokens)) return null;
      status = "partial";
      this.partial = true;
      if (this.outputBoundary !== undefined && u.output_tokens < this.outputBoundary) {
        this.invalid = true;
        status = "unavailable";
      } else {
        if (this.outputBoundary !== undefined) usage.output = u.output_tokens - this.outputBoundary;
        this.outputBoundary = u.output_tokens;
        this.seenPartialOutputs.add(u.output_tokens);
        if (this.previous) this.previous.output = u.output_tokens;
      }
      this.notes.push("Codex partial usage: input/cache split unavailable; only bounded output charged.");
    } else if (!this.session || this.invalid || !u || !valid(u.input_tokens) || !valid(u.output_tokens) ||
        !valid(u.cached_input_tokens) || (u.cache_write_input_tokens !== undefined && !valid(u.cache_write_input_tokens)) ||
        u.cached_input_tokens + Number(u.cache_write_input_tokens ?? 0) > u.input_tokens) {
      status = "unavailable";
      this.notes.push("Codex cumulative usage unavailable or incomplete; no inferred charge.");
    } else {
      const current = { input: u.input_tokens - u.cached_input_tokens - Number(u.cache_write_input_tokens ?? 0),
        output: u.output_tokens, cacheReadInput: u.cached_input_tokens, cacheCreationInput: Number(u.cache_write_input_tokens ?? 0) };
      const identity = keys.map(k => current[k]).join(":");
      if (this.seen.has(identity)) return null;
      this.seen.add(identity);
      if ((this.previous && keys.some(k => current[k] < this.previous![k])) ||
          (this.outputBoundary !== undefined && current.output < this.outputBoundary)) {
        this.invalid = true;
        status = "unavailable";
        this.notes.push("Codex cumulative counters regressed; epoch cannot be attributed.");
      } else {
        if (this.previous) for (const k of keys) usage[k] = current[k] - this.previous[k];
        else {
          status = "partial"; this.partial = true;
          if (this.outputBoundary !== undefined) usage.output = current.output - this.outputBoundary;
        }
        this.previous = current;
        this.outputBoundary = current.output;
        completeObservation = true;
      }
    }
    this.observed = completeObservation;
    return { type: "token_usage", vendor: "codex", turn, timestamp: new Date().toISOString(),
      tokenUsage: usage, tokenDiagnosticStatus: status, tokenCacheProvenance: completeObservation ? "measured" : "unavailable" };
  }
}
