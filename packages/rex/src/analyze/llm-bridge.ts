/**
 * LLM client management bridge.
 *
 * Extracted from reason.ts to break the circular dependency between
 * reason.ts and extract.ts. Both modules can safely import from this
 * module without creating a cycle.
 *
 * Holds the module-level LLM configuration and client singleton, plus
 * the `spawnClaude()` function that sends prompts to the configured
 * LLM provider.
 *
 * @module rex/analyze/llm-bridge
 */

import { randomUUID } from "node:crypto";
import type {
  ClaudeConfig,
  ClaudeClient,
  CompletionResult,
  AuthMode,
  LLMConfig,
  LLMVendor,
  TaskWeight,
} from "@n-dx/llm-client";
import {
  DEFAULT_LLM_VENDOR,
  createLLMClient,
  detectLLMAuthMode,
  resolveVendorModel,
  resolveTaskModel,
} from "@n-dx/llm-client";
import { resolveStore, resolveRexPaths } from "../store/index.js";
import type { LogEntry } from "../schema/index.js";
import type { ClaudeResult } from "./analyze-shared.js";

// ── Module-level LLM state ──

/**
 * Module-level Claude configuration. Set once at CLI entry points via
 * `setClaudeConfig()` so that all internal `spawnClaude()` calls inherit
 * the resolved CLI path without threading config through every function.
 */
let _llmConfig: LLMConfig | undefined;

/**
 * Module-level Claude client instance. Created lazily from the config
 * when the first LLM call is made, or set explicitly at CLI entry points.
 */
let _llmClient: ClaudeClient | undefined;

/**
 * Project directory the vendor CLI should be spawned in. Set once at CLI
 * entry points via `setProjectDir()`, alongside `setClaudeConfig()`. Without
 * it the vendor CLI inherits the calling process's cwd, which is wrong for
 * `rex analyze <dir>` run from outside `<dir>` — the vendor CLI would then
 * resolve its own project context (CLAUDE.md, .mcp.json) against the wrong
 * directory.
 */
let _projectDir: string | undefined;
let _usageCommand: string | undefined;
let _usageScope: string | undefined;

function resolveVendor(): LLMVendor {
  return _llmConfig?.vendor ?? DEFAULT_LLM_VENDOR;
}

/**
 * How a call site describes the work it is asking for: a bare
 * {@link TaskWeight} (legacy — names a tier directly) or a task class
 * (`{ taskClass: "prd.rename" }`), which resolves through the
 * class→tier→model registry and the project's `llm.routes` config.
 * The task class wins when a caller supplies both.
 */
export type SpawnRoute = TaskWeight | { taskClass: string; weight?: TaskWeight };

export function resolveConfiguredModel(model?: string, route: SpawnRoute = "standard"): string {
  return resolveRoute(model, route).model;
}

/**
 * The model for a call plus, for a task-class route, the class and its
 * `llm.effort` value — what the Claude API provider needs to send effort.
 */
function resolveRoute(
  model: string | undefined,
  route: SpawnRoute,
): { model: string; effort?: string; taskClass?: string } {
  if (typeof route === "object" && route.taskClass) {
    const resolution = resolveTaskModel(route.taskClass, _llmConfig ?? {}, {
      model,
      vendor: resolveVendor(),
    });
    return { model: resolution.model, effort: resolution.effort, taskClass: route.taskClass };
  }
  if (model?.trim()) return { model };
  const weight = typeof route === "object" ? (route.weight ?? "standard") : route;
  return { model: resolveVendorModel(resolveVendor(), _llmConfig ?? {}, weight) };
}

// ── Public configuration API ──

export function setLLMConfig(config: LLMConfig): void {
  _llmConfig = config;
  _llmClient = undefined;
}

/**
 * Set the module-level Claude configuration (CLI path, API key, etc.).
 * Call this at CLI entry points before any LLM operations.
 * Also resets the cached client so the next call creates a fresh one
 * using the new configuration.
 */
export function setClaudeConfig(config: ClaudeConfig): void {
  _llmConfig = {
    ...(_llmConfig ?? {}),
    claude: config,
    vendor: _llmConfig?.vendor ?? DEFAULT_LLM_VENDOR,
  };
  _llmClient = undefined;
}

/**
 * Set the module-level Claude client explicitly. This is useful when a
 * client has already been created at the CLI entry point.
 */
export function setClaudeClient(client: ClaudeClient): void {
  _llmClient = client;
}

/**
 * Set the project directory the vendor CLI should be spawned in. Call this
 * at CLI entry points, alongside `setClaudeConfig()`, with the directory
 * being analyzed — not `process.cwd()`. Resets the cached client so the
 * next call spawns in the new directory.
 */
export function setProjectDir(dir: string, command?: string): void {
  _projectDir = dir;
  _usageCommand = command;
  _usageScope = randomUUID();
  _llmClient = undefined;
}

/** Identifies the command-owned aggregate for this invocation's diagnostics. */
export function getUsageScope(): string | undefined {
  return _usageScope;
}

/**
 * Get the current authentication mode being used for LLM calls.
 * Returns "api" when using direct API key authentication, "cli" when
 * using the Claude Code CLI binary. Returns undefined if no config
 * has been set yet.
 */
export function getAuthMode(): AuthMode | undefined {
  if (_llmClient) return _llmClient.mode;
  if (_llmConfig) {
    return detectLLMAuthMode({
      vendor: resolveVendor(),
      llmConfig: _llmConfig,
    });
  }
  return undefined;
}

export function getLLMVendor(): LLMVendor | undefined {
  if (_llmClient || _llmConfig) return resolveVendor();
  return undefined;
}

/**
 * Get or lazily create the module-level Claude client.
 * Falls back to CLI mode when no configuration is available.
 */
function getClient(): ClaudeClient {
  if (_llmClient) return _llmClient;
  const llmConfig = _llmConfig ?? {};
  _llmClient = createLLMClient({
    vendor: resolveVendor(),
    llmConfig,
    cwd: _projectDir,
  });
  return _llmClient;
}

/** Logging must not replace a completion or the error carrying its spend. */
async function recordUsageEntry(projectDir: string, entry: LogEntry): Promise<void> {
  try {
    const store = await resolveStore(resolveRexPaths(projectDir).rexDir);
    await store.appendLog(entry);
  } catch (error) {
    console.warn(`Failed to persist LLM usage: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── LLM interaction ──

/**
 * Send a prompt to Claude using the unified client abstraction.
 *
 * Uses the module-level `ClaudeClient` which supports both direct API
 * and CLI modes transparently. The client is configured via
 * `setClaudeConfig()` at CLI entry points. Retries are handled by the
 * underlying client provider.
 *
 * @param prompt  The prompt to send to Claude
 * @param model   Optional model override. When omitted, resolves from the
 *                active vendor via the centralized vendor/model resolver.
 * @param claudeConfig  Optional config override (creates a one-off client)
 * @param route  What kind of work this call is. Prefer a task class
 *               (`{ taskClass: "prd.rename" }`) so the call resolves through
 *               the routing registry and `llm.routes` config; a bare
 *               {@link TaskWeight} names a tier directly (legacy call sites).
 *               Defaults to "standard" so untouched call sites are
 *               unaffected. An explicit `model` always wins.
 */
export async function spawnClaude(
  prompt: string,
  model?: string,
  claudeConfig?: ClaudeConfig,
  route: SpawnRoute = "standard",
): Promise<ClaudeResult> {
  // When an explicit config is passed, create a one-off client for it
  // instead of using the module-level client.
  const client = claudeConfig
    ? createLLMClient({
      vendor: resolveVendor(),
      llmConfig: {
        ...(_llmConfig ?? {}),
        claude: claudeConfig,
      },
      cwd: _projectDir,
    })
    : getClient();

  const resolution = resolveRoute(model, route);
  const projectDir = _projectDir;
  const command = _usageCommand;
  const usageScope = _usageScope;
  const vendor = resolveVendor();
  try {
    const result = await client.complete({ prompt, ...resolution });
    if (projectDir && result.usageStatus && (result.usageStatus !== "measured"
      || (result.tokenUsage?.input === 0 && result.tokenUsage.output === 0 && !result.tokenUsage.cacheReadInput))) {
      // Diagnostic only: the command still owns successful token totals.
      await recordUsageEntry(projectDir, {
        timestamp: new Date().toISOString(), event: "llm_usage_diagnostic",
        detail: JSON.stringify({ usageStatus: result.usageStatus, command, usageScope, vendor, model: resolution.model }),
      });
    }
    return result;
  } catch (error) {
    // Successful calls are logged by their command. Failed calls never reach
    // that aggregation; record their measured spend here exactly once.
    const failure: (Error & Pick<CompletionResult, "tokenUsage" | "usageStatus">) | undefined =
      error instanceof Error ? error : undefined;
    if (projectDir && failure?.usageStatus) {
      await recordUsageEntry(projectDir, {
        timestamp: new Date().toISOString(), event: "analyze_token_usage",
        detail: JSON.stringify({
          calls: 1, outcome: "failed", usageStatus: failure.usageStatus, command,
          vendor, model: resolution.model,
          inputTokens: failure.tokenUsage?.input ?? 0,
          outputTokens: failure.tokenUsage?.output ?? 0,
          cacheReadInputTokens: failure.tokenUsage?.cacheReadInput ?? 0,
          cacheCreationInputTokens: failure.tokenUsage?.cacheCreationInput ?? 0,
        }),
      });
    }
    throw error;
  }
}
