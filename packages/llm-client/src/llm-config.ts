/**
 * Vendor-neutral configuration loader.
 *
 * Reads `.n-dx.json` and returns an `LLMConfig` object that supports both
 * a new `llm` section and legacy `claude` settings.
 */

import { join } from "node:path";
import { access, readFile } from "node:fs/promises";
import type { LLMConfig, LLMVendor, CodexConfig } from "./llm-types.js";
import type { ClaudeConfig } from "./types.js";

/** Config filename (basename only) — callers pass the containing directory. */
const PROJECT_CONFIG_FILE = "config.json";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function extractVendor(value: unknown): LLMVendor | undefined {
  return value === "claude" || value === "codex" ? value : undefined;
}

function extractClaudeConfig(value: unknown): ClaudeConfig | undefined {
  const v = asRecord(value);
  if (!v) return undefined;

  const cfg: ClaudeConfig = {};
  if (typeof v.cli_path === "string" && v.cli_path) cfg.cli_path = v.cli_path;
  if (typeof v.api_key === "string" && v.api_key) cfg.api_key = v.api_key;
  if (typeof v.api_endpoint === "string" && v.api_endpoint) cfg.api_endpoint = v.api_endpoint;
  if (typeof v.model === "string" && v.model) cfg.model = v.model;
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}

function extractCodexConfig(value: unknown): CodexConfig | undefined {
  const v = asRecord(value);
  if (!v) return undefined;

  const cfg: CodexConfig = {};
  if (typeof v.cli_path === "string" && v.cli_path) cfg.cli_path = v.cli_path;
  if (typeof v.api_key === "string" && v.api_key) cfg.api_key = v.api_key;
  if (typeof v.api_endpoint === "string" && v.api_endpoint) cfg.api_endpoint = v.api_endpoint;
  if (typeof v.model === "string" && v.model) cfg.model = v.model;
  return Object.keys(cfg).length > 0 ? cfg : undefined;
}

/**
 * Load the vendor-neutral LLM config from `.n-dx.json`.
 *
 * Merge behavior:
 * - Reads `llm.vendor` if present.
 * - Reads `llm.claude`/`llm.codex` blocks when present.
 * - Falls back to legacy top-level `claude` block for compatibility.
 */
export async function loadLLMConfig(dir: string): Promise<LLMConfig> {
  const path = join(dir, PROJECT_CONFIG_FILE);
  try {
    await access(path);
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw);
    const root = asRecord(data);
    if (!root) return {};

    const llm = asRecord(root.llm);
    const llmVendor = extractVendor(llm?.vendor);
    const llmClaude = extractClaudeConfig(llm?.claude);
    const llmCodex = extractCodexConfig(llm?.codex);
    const legacyClaude = extractClaudeConfig(root.claude);

    const config: LLMConfig = {};
    if (llmVendor) config.vendor = llmVendor;
    if (llmClaude || legacyClaude) config.claude = llmClaude ?? legacyClaude;
    if (llmCodex) config.codex = llmCodex;
    return config;
  } catch {
    return {};
  }
}
