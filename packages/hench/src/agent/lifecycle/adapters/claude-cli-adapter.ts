/**
 * Claude CLI adapter — VendorAdapter implementation for the Claude CLI.
 *
 * Hench's policy on top of llm-client's Claude session driver:
 * - `buildSpawnConfig()` — maps a PromptEnvelope + ExecutionPolicy to the
 *   driver's turn (allowed tools from the policy, effort, permission mode,
 *   MCP config, resume/fork) and wraps it as a SpawnConfig.
 * - `parseEvent()` / `extractSessionId()` — the driver's stream-json parser
 *   and session-id capture, shared with the Sidecar's sessions.
 * - `detectBackgroundWait()` — which Claude tools wait on a notification.
 * - `classifyError()` — the shared `classifyVendorError` taxonomy.
 *
 * @see packages/hench/src/agent/lifecycle/vendor-adapter.ts — VendorAdapter interface
 * @see packages/llm-client/src/vendor-session-driver.ts — argv, parsing, session ids
 * @see docs/architecture/phase2-vendor-normalization.md — design rationale
 */

import type {
  VendorAdapter,
  SpawnConfig,
  VendorSpawnOptions,
  BackgroundWaitSignal,
} from "../vendor-adapter.js";
import type {
  PromptEnvelope,
  ExecutionPolicy,
  RuntimeEvent,
  FailureCategory,
} from "../../../prd/llm-gateway.js";
import {
  LLM_VENDOR,
  assemblePrompt,
  classifyVendorError,
  claudeSessionDriver,
} from "../../../prd/llm-gateway.js";
import type { PermissionMode } from "../../../schema/index.js";
import { AGENT_REX_MCP_TOOLS } from "../../../process/agent-mcp-config.js";

export { WINDOWS_STDIN_PROMPT_SEPARATOR } from "../../../prd/llm-gateway.js";

// ── Constants ────────────────────────────────────────────────────────────

/** File tools that Claude CLI should auto-approve (scoped to cwd). */
const CLI_FILE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"];

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build the `--allowed-tools` list for the Claude CLI.
 *
 * Maps the policy's `allowedCommands` (e.g. `["npm", "git"]`) to Claude CLI's
 * tool pattern format (e.g. `["Bash(npm:*)", "Bash(git:*)"]`), and includes
 * file tools that are inherently scoped to `cwd` by Claude CLI.
 *
 * When `allowedGitSubcommands` is provided and non-empty, `git` is granted at
 * subcommand granularity (`Bash(git commit:*)`, `Bash(git status:*)`, …) rather
 * than the blanket `Bash(git:*)`. This mirrors the API-provider guard's
 * `checkGitSubcommand` allowlist, so destructive subcommands not on the list
 * (`reset`, `clean`, `revert`, `push`) are not auto-approved in CLI mode — they
 * fall through to a permission prompt (denied under a non-interactive
 * `acceptEdits` spawn). When the list is omitted/empty, `git` keeps its legacy
 * blanket grant for backward compatibility.
 *
 * The list also carries {@link AGENT_REX_MCP_TOOLS} — the rex MCP tools hench's
 * own prompts direct the agent to call, on the rex server hench itself attaches.
 * They are granted unconditionally rather than only alongside `--mcp-config`,
 * because a session that inherits its registrations reads the same tools from
 * the same server name, and naming a tool no attached server provides is inert.
 * Applying here rather than at a call site is what makes the grant reach *every*
 * Claude spawn: `buildSpawnConfig` is the only producer of Claude CLI args, so
 * the work spawn, its retries, the adversarial review pass and the reviewer's
 * background-wait resume all pass through this function.
 */
export function buildAllowedTools(
  allowedCommands: ReadonlyArray<string>,
  allowedGitSubcommands?: ReadonlyArray<string>,
): string[] {
  const scopeGit = !!allowedGitSubcommands && allowedGitSubcommands.length > 0;
  const bashTools = allowedCommands.flatMap((cmd) =>
    cmd === "git" && scopeGit
      ? allowedGitSubcommands!.map((sub) => `Bash(git ${sub}:*)`)
      : [`Bash(${cmd}:*)`],
  );
  return [...bashTools, ...CLI_FILE_TOOLS, ...AGENT_REX_MCP_TOOLS];
}

/**
 * Input to {@link buildClaudeCliArgs}.
 *
 * @internal Exported for snapshot testing — not part of the adapter's public API.
 */
export interface ClaudeCliInput {
  systemPrompt: string;
  promptText: string;
  allowedTools: string[];
  modelOverride?: string;
  /**
   * Effort level for the spawned session (`--effort <level>`).
   *
   * Already resolved by the caller through `resolveClaudeCliEffort`, which
   * drops an unknown level or a model that does not accept one. Undefined
   * when no `llm.effort` rule matched, and the flag is then omitted so Claude
   * Code uses its own per-model default rather than one of ours.
   */
  effort?: string;
  /**
   * Permission posture for the spawned session (`--permission-mode <mode>`).
   * Undefined omits the flag, so Claude CLI uses its built-in default mode.
   */
  permissionMode?: PermissionMode;
  /**
   * When set, resume this Claude CLI session instead of starting a new one
   * (`--resume <id>`). The prompt on stdin becomes the next turn of that
   * conversation, so the model still has the task context in its window.
   * Orthogonal to `modelOverride` — resuming with a different model is
   * exactly what the review pass does.
   */
  resumeSessionId?: string;
  /**
   * Fork the resumed session instead of continuing it (`--fork-session`),
   * so the spawn inherits the parent transcript under a new session id and
   * leaves the parent unmutated. That is what makes one orientation session
   * reusable across many task spawns. Ignored without {@link resumeSessionId}.
   */
  forkSession?: boolean;
  /**
   * Path to an MCP config file that becomes the session's *only* source of MCP
   * servers (`--mcp-config <file> --strict-mcp-config`).
   *
   * Set for every Claude spawn in a run that could resolve the CLI which
   * launched it, so the agent's rex and sourcevision servers name this run's
   * project directory absolutely. Without it the session inherits whatever
   * Claude Code has registered for the repository, and a local-scope
   * registration pinning another worktree silently redirects the agent's PRD
   * writes there. Omitted when no usable launcher CLI could be identified.
   *
   * @see packages/hench/src/process/agent-mcp-config.ts — builds the file
   */
  mcpConfigPath?: string;
}

/**
 * Build the Claude CLI args and stdin content for one spawn.
 *
 * The argv itself is llm-client's Claude session driver, so a hench spawn and
 * a Sidecar turn resume and fork with the same flags. On Windows the system
 * prompt travels in stdin and allowed-tools are joined as one token.
 *
 * @param platform Overridable ONLY so tests can exercise both delivery shapes on
 *   any host. Defaults to the real platform; every production caller passes one
 *   argument.
 */
export function buildClaudeCliArgs(
  input: ClaudeCliInput,
  platform: NodeJS.Platform = process.platform,
): { args: string[]; stdinContent: string } {
  const { args, stdin } = claudeSessionDriver.turnSpawn(
    {
      systemPrompt: input.systemPrompt,
      prompt: input.promptText,
      model: input.modelOverride,
      resume: input.resumeSessionId
        ? { sessionId: input.resumeSessionId, fork: input.forkSession }
        : undefined,
      claude: {
        allowedTools: input.allowedTools,
        effort: input.effort,
        permissionMode: input.permissionMode,
        mcpConfigPath: input.mcpConfigPath,
      },
    },
    platform,
  );
  return { args, stdinContent: stdin };
}

// ── Background waits ─────────────────────────────────────────────────────

/** Claude CLI tools whose only purpose is to wait for a later notification. */
const CLAUDE_WAIT_TOOLS = new Set(["ScheduleWakeup", "Monitor"]);

const BACKGROUND_DETAIL_LENGTH = 120;

/**
 * The background signal a Claude CLI `tool_use` carries, if any.
 *
 * Two shapes count: a `Bash` call with `run_in_background: true` (strictly
 * `true`: a stringly `"true"` is not what the CLI honours), and any
 * `ScheduleWakeup` or `Monitor` call, which exist only to wait for something
 * that never arrives in a `claude -p` session. Polling a job's output
 * (`BashOutput`) is the agent still working, and does not count.
 *
 * @internal Exported for testing.
 */
export function detectClaudeBackgroundWait(toolCall: {
  tool: string;
  input: Readonly<Record<string, unknown>> | undefined;
}): BackgroundWaitSignal | undefined {
  const { tool, input } = toolCall;
  if (tool === "Bash" && input?.run_in_background === true) {
    const command = typeof input.command === "string" ? input.command : "";
    return { tool, detail: command.slice(0, BACKGROUND_DETAIL_LENGTH) };
  }
  if (CLAUDE_WAIT_TOOLS.has(tool)) {
    const reason = typeof input?.reason === "string" ? input.reason : "";
    return { tool, detail: reason.slice(0, BACKGROUND_DETAIL_LENGTH) };
  }
  return undefined;
}

// ── ClaudeCliAdapter ─────────────────────────────────────────────────────

/**
 * VendorAdapter implementation for the Claude CLI.
 *
 * Stateless — all method inputs are passed as parameters.
 */
export const claudeCliAdapter: VendorAdapter = {
  vendor: LLM_VENDOR.CLAUDE,
  parseMode: "stream-json",
  resumesUnfinishedSessions: true,

  buildSpawnConfig(
    envelope: PromptEnvelope,
    policy: ExecutionPolicy,
    opts: VendorSpawnOptions,
  ): SpawnConfig {
    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);
    const allowedTools = buildAllowedTools(policy.allowedCommands, policy.allowedGitSubcommands);

    const { args, stdinContent } = buildClaudeCliArgs({
      systemPrompt,
      promptText: taskPrompt,
      allowedTools,
      modelOverride: opts.model,
      effort: opts.effort,
      permissionMode: opts.permissionMode,
      resumeSessionId: opts.resumeSessionId,
      forkSession: opts.forkSession,
      mcpConfigPath: opts.mcpConfigPath,
    });

    return {
      binary: "claude",
      args,
      env: {},
      stdinContent,
      cwd: ".",
    };
  },

  parseEvent(line: string, turn: number): RuntimeEvent | null {
    return claudeSessionDriver.parseLine(line, turn);
  },

  /**
   * The Claude CLI stamps `session_id` on many stream-json lines, so the
   * first one wins — see the run loop, which keeps only the first value.
   */
  extractSessionId(rawJson: unknown): string | undefined {
    return claudeSessionDriver.extractSessionId(rawJson);
  },

  detectBackgroundWait: detectClaudeBackgroundWait,

  classifyError(err: unknown): FailureCategory {
    return classifyVendorError(err);
  },
};
