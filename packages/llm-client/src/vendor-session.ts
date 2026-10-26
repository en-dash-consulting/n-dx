/**
 * Resumable multi-turn vendor CLI sessions.
 *
 * A {@link VendorSession} holds one conversation with the Claude or Codex CLI
 * across turns. Each turn is one CLI spawn: the first starts the session (or
 * resumes / forks an existing one by id), every later turn resumes the id the
 * previous turn reported. The id is the session's only state, so a session
 * outlives its process — store {@link VendorSession.sessionId} and
 * {@link resumeVendorSession} picks it up after a restart.
 *
 * Each turn's output is normalized into {@link RuntimeEvent}s, `token_usage`
 * included, delivered live through `onEvent` and returned with the turn.
 *
 * Vendor knowledge (argv, line parsing, session-id capture, usage) is the
 * driver's — see `vendor-session-driver.ts`. One-shot completion stays with
 * `createLLMClient`; this is the multi-turn surface beside it.
 *
 * @module llm-client/vendor-session
 */

import { spawnCli } from "./exec.js";
import type { SpawnCliOptions } from "./exec.js";
import { terminateProcessTree } from "./process-tree.js";
import type { RuntimeEvent } from "./runtime-contract.js";
import type { TokenUsage } from "./types.js";
import { UsageMessageFilter } from "./usage-dedup.js";
import type {
  ClaudeTurnFlags,
  CodexTurnFlags,
  SessionResume,
  VendorSessionDriver,
} from "./vendor-session-driver.js";
import { vendorSessionDriver } from "./vendor-session-driver.js";

type ChildProcess = ReturnType<typeof spawnCli>;

export type VendorSessionState = "idle" | "running" | "ended";

export interface VendorSessionOptions {
  /** `claude` or `codex`. Any other vendor has no resumable CLI session. */
  readonly vendor: string;
  /** Working directory every turn runs in. */
  readonly cwd: string;
  /** System prompt sent with each turn. */
  readonly systemPrompt?: string;
  /** Model override for every turn. */
  readonly model?: string;
  /** CLI binary path; defaults to the driver's (`claude`, `codex`). */
  readonly binary?: string;
  /** Child environment; defaults to the parent's. */
  readonly env?: NodeJS.ProcessEnv;
  readonly claude?: ClaudeTurnFlags;
  readonly codex?: CodexTurnFlags;
  /** Called with each event as it is parsed. */
  readonly onEvent?: (event: RuntimeEvent) => void;
  /** @internal Test seam; production uses `spawnCli`. */
  readonly spawn?: (binary: string, args: string[], opts: SpawnCliOptions) => ChildProcess;
}

export interface ResumeVendorSessionOptions extends VendorSessionOptions {
  /**
   * Branch the session on the first turn instead of continuing it, leaving
   * the original transcript as it was. Claude only.
   */
  readonly fork?: boolean;
}

export type SessionTurnStatus = "completed" | "failed" | "interrupted";

export interface SessionTurnResult {
  /** 1-based turn number within this session object. */
  readonly turn: number;
  readonly status: SessionTurnStatus;
  /** The id the next turn resumes; undefined if the CLI never reported one. */
  readonly sessionId?: string;
  /** Every event the turn produced, in order. */
  readonly events: readonly RuntimeEvent[];
  /** Sum of the turn's `token_usage` events. */
  readonly tokenUsage: TokenUsage;
  /** Completion summary, else the last assistant text. */
  readonly text?: string;
  readonly error?: string;
  readonly exitCode: number | null;
}

export interface VendorSession {
  readonly vendor: string;
  /** The id the next turn resumes, once there is one. */
  readonly sessionId: string | undefined;
  readonly state: VendorSessionState;
  /** Turns sent so far. */
  readonly turns: number;
  /** Run one turn. Rejects while another turn runs or after {@link end}. */
  sendTurn(prompt: string): Promise<SessionTurnResult>;
  /** Stop the running turn, if any; the session stays usable. */
  interrupt(): Promise<void>;
  /** Stop any running turn and refuse further turns. Idempotent. */
  end(): Promise<void>;
}

function requireDriver(vendor: string): VendorSessionDriver {
  const driver = vendorSessionDriver(vendor);
  if (!driver) {
    throw new Error(`No resumable CLI session for vendor "${vendor}" (supported: claude, codex)`);
  }
  return driver;
}

/** Start a new session. Nothing is spawned until the first {@link VendorSession.sendTurn}. */
export function startVendorSession(opts: VendorSessionOptions): VendorSession {
  return createSession(requireDriver(opts.vendor), opts, undefined);
}

/**
 * Continue a session by its vendor id — after a restart, or to branch a
 * shared parent with `fork`.
 */
export function resumeVendorSession(
  sessionId: string,
  opts: ResumeVendorSessionOptions,
): VendorSession {
  const driver = requireDriver(opts.vendor);
  if (!sessionId) throw new Error("resumeVendorSession needs a session id");
  if (opts.fork && !driver.canFork) {
    throw new Error(`The ${driver.vendor} CLI cannot fork a session`);
  }
  return createSession(driver, opts, { sessionId, fork: opts.fork || undefined });
}

function addUsage(total: TokenUsage, add: TokenUsage): TokenUsage {
  const sum: TokenUsage = { input: total.input + add.input, output: total.output + add.output };
  const creation = (total.cacheCreationInput ?? 0) + (add.cacheCreationInput ?? 0);
  const read = (total.cacheReadInput ?? 0) + (add.cacheReadInput ?? 0);
  if (creation) sum.cacheCreationInput = creation;
  if (read) sum.cacheReadInput = read;
  return sum;
}

function createSession(
  driver: VendorSessionDriver,
  opts: VendorSessionOptions,
  initial: SessionResume | undefined,
): VendorSession {
  const spawnImpl = opts.spawn ?? spawnCli;
  // One filter for the whole session: message ids are unique per
  // conversation, and a resumed turn may replay none of them.
  const usageFilter = new UsageMessageFilter();
  let pending: SessionResume | undefined = initial;
  let sessionId: string | undefined = initial?.sessionId;
  let state: VendorSessionState = "idle";
  let turns = 0;
  let child: ChildProcess | undefined;
  let interrupted = false;

  async function stopChild(): Promise<void> {
    if (!child) return;
    interrupted = true;
    await terminateProcessTree(child);
  }

  function runTurn(prompt: string, turn: number): Promise<SessionTurnResult> {
    const resume: SessionResume | undefined = pending ?? (sessionId ? { sessionId } : undefined);
    const spawnSpec = driver.turnSpawn({
      systemPrompt: opts.systemPrompt ?? "",
      prompt,
      model: opts.model,
      resume,
      claude: opts.claude,
      codex: opts.codex,
    });

    return new Promise((resolve) => {
      const events: RuntimeEvent[] = [];
      let tokenUsage: TokenUsage = { input: 0, output: 0 };
      let turnSessionId: string | undefined;
      let completion: string | undefined;
      let lastAssistant: string | undefined;
      let failure: string | undefined;
      let spawnError: string | undefined;
      let stderr = "";
      let buffer = "";
      let settled = false;

      const emit = (event: RuntimeEvent): void => {
        events.push(event);
        if (event.type === "token_usage" && event.tokenUsage) {
          tokenUsage = addUsage(tokenUsage, event.tokenUsage);
        } else if (event.type === "completion" && event.completionSummary) {
          completion = event.completionSummary;
        } else if (event.type === "assistant" && event.text) {
          lastAssistant = event.text;
        } else if (event.type === "failure" && event.failure) {
          failure = event.failure.message;
        }
        opts.onEvent?.(event);
      };

      const processLine = (line: string): void => {
        if (!line.trim()) return;
        const event = driver.parseLine(line, turn);
        if (event) emit(event);
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          return; // not JSON: no session id or usage to read
        }
        // First id of the turn wins, so a late payload cannot redirect the
        // next resume.
        if (!turnSessionId) turnSessionId = driver.extractSessionId(raw);
        const hasUsage = tokenUsage.input > 0 || tokenUsage.output > 0;
        const usage = driver.usageEvent(raw, turn, usageFilter, hasUsage);
        if (usage) emit(usage);
      };

      const proc = spawnImpl(opts.binary ?? spawnSpec.binary, spawnSpec.args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child = proc;

      proc.stdin?.on("error", () => {
        // The CLI exited before reading its prompt; `close` reports why.
      });
      proc.stdin?.end(spawnSpec.stdin, "utf-8");

      proc.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        child = undefined;
        if (buffer.trim()) processLine(buffer);
        buffer = "";

        if (turnSessionId) {
          sessionId = turnSessionId;
          pending = undefined;
        } else if (!pending?.fork) {
          // A plain resume that reported nothing still continues the same id.
          pending = undefined;
        }

        const status: SessionTurnStatus = interrupted
          ? "interrupted"
          : spawnError || failure || exitCode !== 0
            ? "failed"
            : "completed";
        const error = status === "failed"
          ? spawnError ?? failure ??
            (stderr.trim() || `${driver.vendor} exited with code ${exitCode}`)
          : undefined;

        resolve({
          turn,
          status,
          sessionId,
          events,
          tokenUsage,
          text: completion ?? lastAssistant,
          error,
          exitCode,
        });
      };

      proc.on("error", (err) => {
        spawnError = (err as NodeJS.ErrnoException).code === "ENOENT"
          ? `${driver.vendor} CLI not found (${opts.binary ?? spawnSpec.binary})`
          : err.message;
        finish(null);
      });
      proc.on("close", (code) => finish(code));
    });
  }

  return {
    vendor: driver.vendor,
    get sessionId() {
      return sessionId;
    },
    get state() {
      return state;
    },
    get turns() {
      return turns;
    },

    async sendTurn(prompt: string): Promise<SessionTurnResult> {
      if (state === "ended") throw new Error("Session has ended");
      if (state === "running") throw new Error("A turn is already running in this session");
      state = "running";
      interrupted = false;
      turns += 1;
      try {
        return await runTurn(prompt, turns);
      } finally {
        if (state === "running") state = "idle";
      }
    },

    async interrupt(): Promise<void> {
      await stopChild();
    },

    async end(): Promise<void> {
      if (state === "ended") return;
      state = "ended";
      await stopChild();
    },
  };
}
