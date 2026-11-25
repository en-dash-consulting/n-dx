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
  resumesUnfinishedSessions: true,

  createUnfinishedSessionTracker() {
    let turnOpen = false;
    let failed = false;
    const commands = new Set<string>();
    return {
      observe(raw: unknown) {
        if (!raw || typeof raw !== "object") return;
        const event = raw as Record<string, unknown>;
        if (event.type === "turn.started") turnOpen = true;
        if (event.type === "turn.completed") turnOpen = false;
        if (event.type === "turn.failed" || event.type === "error") failed = true;
        const item = event.item as Record<string, unknown> | undefined;
        if (!item || item.type !== "command_execution" || typeof item.id !== "string") return;
        if ((event.type === "item.started" || event.type === "item.updated") && item.status === "in_progress") {
          commands.add(item.id);
        } else if (event.type === "item.completed") {
          commands.delete(item.id);
        }
      },
      signal() {
        if (failed) return undefined;
        if (commands.size) return { tool: "command_execution", detail: "command has no completion event" };
        if (turnOpen) return { tool: "turn.started", detail: "turn has no completion event" };
        return undefined;
      },
    };
  },

  buildSpawnConfig(
    envelope: PromptEnvelope,
    policy: ExecutionPolicy,
    opts: VendorSpawnOptions,
  ): SpawnConfig {
    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

    // Hench resolution and run diagnostics report command/Git/blocked-path guards
    // that this sandbox cannot enforce. This adapter only compiles the native
    // filesystem, network and approval controls; it must not claim allowlists.
    //
    // Fork/resume reapply the execution policy; neither inherits permission.
    const build = (scratchDir?: string): SpawnConfig => {
      const { binary, args, stdin } = codexSessionDriver.turnSpawn({
        systemPrompt,
        prompt: taskPrompt,
        model: opts.model,
        resume: opts.resumeSessionId ? { sessionId: opts.resumeSessionId, fork: opts.forkSession } : undefined,
        codex: {
          forkSupported: opts.codexForkSupported,
          effort: opts.effort,
          // With a verified binding, orientation disables MCP at the native
          // preflight too. Keep user/provider/organizational configuration.
          configFlags: opts.mcpConfigPath
            ? opts.codexOrientationFlags?.filter(flag => flag !== "--ignore-user-config")
            : opts.codexOrientationFlags,
          policyFlags: compileCodexPolicyFlags(policy, { scratchDir }),
          resumePolicyFlags: compileCodexPolicyFlags(policy, { resume: true, scratchDir }),
        },
      });

      return {
        binary,
        ...(opts.mcpConfigPath ? { codexMcpBinding: {
          path: opts.mcpConfigPath, disabled: opts.codexOrientationFlags !== undefined,
        } } : {}),
        usageResumeSessionId: opts.resumeSessionId,
        args,
        env: scratchDir ? { TMPDIR: scratchDir, TMP: scratchDir, TEMP: scratchDir } : {},
        ...(policy.sandbox === "workspace-write" && !scratchDir ? { withScratchDir: build } : {}),
        // The prompt always travels on stdin; see the driver for why not argv.
        stdinContent: stdin,
        cwd: ".",
      };
    };
    return build();
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
