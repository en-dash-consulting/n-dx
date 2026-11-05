/**
 * Codex CLI adapter — VendorAdapter implementation for the Codex CLI.
 *
 * Hench's policy on top of llm-client's Codex session driver:
 * - `buildSpawnConfig()` — compiles the ExecutionPolicy into sandbox/approval
 *   flags and hands the driver a fresh or resumed turn.
 * - `parseEvent()` / `extractSessionId()` — the driver's JSONL parser (with
 *   its heuristic fallback for unstructured output) and `thread.started`
 *   capture, shared with the Sidecar's sessions.
 * - `classifyError()` — the shared `classifyVendorError` taxonomy.
 *
 * `normalizeCodexResponse` and `parseMaybeJson` are re-exported from the
 * driver for the callers that predate the move.
 *
 * @see packages/hench/src/agent/lifecycle/vendor-adapter.ts — VendorAdapter interface
 * @see packages/llm-client/src/vendor-session-driver.ts — argv, parsing, session ids
 * @see docs/architecture/phase2-vendor-normalization.md — design rationale
 */

import type { VendorAdapter, SpawnConfig, VendorSpawnOptions } from "../vendor-adapter.js";
import type {
  PromptEnvelope,
  ExecutionPolicy,
  RuntimeEvent,
  FailureCategory,
} from "../../../prd/llm-gateway.js";
import {
  LLM_VENDOR,
  assemblePrompt,
  compileCodexPolicyFlags,
  classifyVendorError,
  codexSessionDriver,
} from "../../../prd/llm-gateway.js";

export { normalizeCodexResponse, parseMaybeJson } from "../../../prd/llm-gateway.js";
export type {
  NormalizedCodexResponse,
  NormalizedCodexToolEvent,
} from "../../../prd/llm-gateway.js";

/**
 * VendorAdapter implementation for the Codex CLI.
 *
 * Stateless — all method inputs are passed as parameters.
 */
export const codexCliAdapter: VendorAdapter = {
  vendor: LLM_VENDOR.CODEX,
  parseMode: "json",
  // `codex exec resume` exists (the batch chain and transient retries use it
  // through their own paths), but resuming a session that ended unfinished is
  // not enabled for Codex yet: nothing here detects that it ended waiting.
  resumesUnfinishedSessions: false,

  buildSpawnConfig(
    envelope: PromptEnvelope,
    policy: ExecutionPolicy,
    opts: VendorSpawnOptions,
  ): SpawnConfig {
    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

    // policy.allowedGitSubcommands is intentionally not consulted — Codex has no
    // per-command allowlist surface (its safety model is the sandbox/approval
    // flags), so git-subcommand scoping is a Claude-CLI-only control.
    //
    // opts.permissionMode and opts.forkSession are ignored: neither has a Codex
    // equivalent. The batch strategy's resume is a plain `exec resume`, which
    // appends to the thread; the driver drops the policy flags there because
    // the resumed thread keeps its own.
    const { binary, args, stdin } = codexSessionDriver.turnSpawn({
      systemPrompt,
      prompt: taskPrompt,
      model: opts.model,
      resume: opts.resumeSessionId ? { sessionId: opts.resumeSessionId } : undefined,
      codex: { policyFlags: compileCodexPolicyFlags(policy) },
    });

    return {
      binary,
      args,
      env: {},
      // The prompt always travels on stdin; see the driver for why not argv.
      stdinContent: stdin,
      cwd: ".",
    };
  },

  parseEvent(line: string, turn: number): RuntimeEvent | null {
    return codexSessionDriver.parseLine(line, turn);
  },

  /**
   * Codex announces its thread once, as `{"type":"thread.started","thread_id":"…"}`.
   * A resumed spawn re-emits the id it continued, so the chain stays on one thread.
   */
  extractSessionId(rawJson: unknown): string | undefined {
    return codexSessionDriver.extractSessionId(rawJson);
  },

  /**
   * Never reports a background wait. `codex exec` has no known tool that
   * hands work to the background and notifies later, and a shell command
   * backgrounded with `&` inside a `command_execution` item is not detected —
   * telling that apart from a legitimately detached process would mean
   * parsing shell.
   */
  detectBackgroundWait(): undefined {
    return undefined;
  },

  classifyError(err: unknown): FailureCategory {
    return classifyVendorError(err);
  },
};
