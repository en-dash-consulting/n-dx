import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadProjectOverrides, mergeWithOverrides, PROJECT_DIRS } from "@n-dx/llm-client";
import { validateConfig, validateLogEntry } from "../schema/validate.js";
import type { BudgetConfig, TokenUsageLogEntry } from "./token-usage.js";

interface TokenUsageConfig {
  budget?: BudgetConfig & {
    abort?: boolean;
  };
}

export async function loadTokenUsageConfig(rexDir: string): Promise<TokenUsageConfig> {
  const raw = await readFile(join(rexDir, "config.json"), "utf-8");
  const parsed = JSON.parse(raw);
  const result = validateConfig(parsed);
  if (!result.ok) {
    throw new Error(`Invalid config.json: ${result.errors.message}`);
  }

  const overrides = await loadProjectOverrides(dirname(rexDir), PROJECT_DIRS.REX);
  return mergeWithOverrides(result.data, overrides) as TokenUsageConfig;
}

export async function readTokenUsageLog(rexDir: string): Promise<TokenUsageLogEntry[]> {
  let raw: string;
  try {
    raw = await readFile(join(rexDir, "execution-log.jsonl"), "utf-8");
  } catch {
    return [];
  }

  const entries: TokenUsageLogEntry[] = [];
  for (const line of raw.trim().split("\n").filter(Boolean)) {
    try {
      const parsed = JSON.parse(line);
      const result = validateLogEntry(parsed);
      if (result.ok) {
        entries.push(result.data as TokenUsageLogEntry);
      }
    } catch {
      // Skip malformed lines.
    }
  }

  return entries;
}
