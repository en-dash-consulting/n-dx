/**
 * Vendor-neutral configuration loader.
 *
 * Reads `.n-dx.json` and returns an `LLMConfig` object that supports both
 * a new `llm` section and legacy `claude` settings.
 */

import { join } from "node:path";
import { access, readFile } from "node:fs/promises";
import { deepMerge } from "./project-config.js";
import type { LLMConfig, LLMVendor, CodexConfig } from "./llm-types.js";
import type { ClaudeConfig } from "./types.js";

const PROJECT_CONFIG_FILE = ".n-dx.json";
const LOCAL_CONFIG_FILE = ".n-dx.local.json";

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
 * Load and parse a JSON file, returning null on failure.
 */
async function loadJSONFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    await access(filePath);
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    return asRecord(data) ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract an LLMConfig from a merged root object.
 */
function extractLLMConfig(root: Record<string, unknown>): LLMConfig {
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
}

/**
 * Load the vendor-neutral LLM config from `.n-dx.json`,
 * with `.n-dx.local.json` overrides merged on top (local wins).
 *
 * Merge behavior:
 * - Reads `llm.vendor` if present.
 * - Reads `llm.claude`/`llm.codex` blocks when present.
 * - Falls back to legacy top-level `claude` block for compatibility.
 */
export async function loadLLMConfig(dir: string): Promise<LLMConfig> {
  const projectData = await loadJSONFile(join(dir, PROJECT_CONFIG_FILE));
  const localData = await loadJSONFile(join(dir, LOCAL_CONFIG_FILE));

  // Merge project and local configs (local wins)
  let merged: Record<string, unknown> | null = projectData;
  if (projectData && localData) {
    merged = deepMerge(projectData, localData);
  } else if (localData) {
    merged = localData;
  }

  if (!merged) return {};
  return extractLLMConfig(merged);
}
