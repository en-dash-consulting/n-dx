/**
 * Per-vendor live model list and installed-CLI probe behind GET /api/llm/catalog.
 *
 * Neither the `claude` nor the `codex` CLI can list models, so the live list
 * comes from the vendor API (`listVendorModels` in `@n-dx/llm-client`) and needs
 * a key. Without one, or when the call fails, the caller keeps the built-in
 * list — this module only reports what it learned and never throws.
 *
 * Both the list and the `<binary> --version` probe cost a network round trip or
 * a process spawn, so the pair is cached per project and vendor for
 * {@link CATALOG_CACHE_TTL_MS}. `?refresh=true` refills it and a config save
 * clears it, because either can change which key or binary applies.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LLM_VENDOR, deepMerge, exec, listVendorModels, loadLLMConfig } from "@n-dx/llm-client";
import type { LLMConfig, ListableVendor } from "@n-dx/llm-client";

/** How long a live list and CLI probe are served before they are fetched again. */
export const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

const CLI_PROBE_TIMEOUT_MS = 5000;

/** The installed CLI for a vendor, from `<binary> --version`. */
export interface CliInfo {
  found: boolean;
  version: string | null;
  path: string | null;
}

/** What one vendor's live lookup produced. */
export interface LiveVendorProbe {
  listing: { ok: true; models: string[] } | { ok: false; reason: string };
  /** ISO time the listing was fetched. */
  checkedAt: string;
  cli: CliInfo;
}

interface CacheEntry {
  expiresAt: number;
  probe: LiveVendorProbe;
}

const cache = new Map<string, CacheEntry>();

const cacheKey = (projectDir: string, vendor: ListableVendor): string => `${projectDir}\0${vendor}`;

/** Drop every cached probe for `projectDir` (after a config save). */
export function clearLlmCatalogCache(projectDir: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${projectDir}\0`)) cache.delete(key);
  }
}

function readJson(path: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** `.n-dx.json` merged with the gitignored `.n-dx.local.json` (local wins), as runs read it. */
function readProjectConfig(projectDir: string): Record<string, unknown> {
  return deepMerge(readJson(join(projectDir, ".n-dx.json")), readJson(join(projectDir, ".n-dx.local.json")));
}

function stringAt(obj: unknown, ...keys: string[]): string | undefined {
  let cur: unknown = obj;
  for (const key of keys) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" && cur ? cur : undefined;
}

/**
 * The binary a run would invoke for `vendor`: `CLAUDE_CLI_PATH`, then
 * `cli.claudePath` for Claude; `llm.codex.cli_path` for Codex; else the bare
 * name, resolved on PATH.
 */
function resolveBinary(vendor: ListableVendor, projectDir: string): string {
  const config = readProjectConfig(projectDir);
  if (vendor === LLM_VENDOR.CLAUDE) {
    return process.env.CLAUDE_CLI_PATH || stringAt(config, "cli", "claudePath") || "claude";
  }
  return stringAt(config, "llm", "codex", "cli_path") || "codex";
}

/** First `1.2.3`-shaped token in `--version` output (`2.1.0 (Claude Code)`, `codex-cli 0.46.0`). */
function parseVersion(output: string): string | null {
  return /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(output)?.[0] ?? null;
}

async function probeCli(vendor: ListableVendor, projectDir: string): Promise<CliInfo> {
  const binary = resolveBinary(vendor, projectDir);
  const result = await exec(binary, ["--version"], { cwd: projectDir, timeout: CLI_PROBE_TIMEOUT_MS });
  if (!result.launched || result.exitCode !== 0) return { found: false, version: null, path: null };
  return { found: true, version: parseVersion(result.stdout) ?? parseVersion(result.stderr), path: binary };
}

async function probeVendor(
  vendor: ListableVendor,
  projectDir: string,
  config: LLMConfig,
): Promise<LiveVendorProbe> {
  const [listing, cli] = await Promise.all([
    listVendorModels(vendor, config),
    probeCli(vendor, projectDir),
  ]);
  return { listing, checkedAt: new Date().toISOString(), cli };
}

/**
 * The live list and CLI probe for `vendor`, from cache while fresh.
 * `refresh` bypasses the cache and refills it.
 */
export async function getLiveVendorProbe(
  vendor: ListableVendor,
  projectDir: string,
  options: { refresh?: boolean } = {},
): Promise<LiveVendorProbe> {
  const key = cacheKey(projectDir, vendor);
  const hit = cache.get(key);
  if (!options.refresh && hit && hit.expiresAt > Date.now()) return hit.probe;

  const probe = await probeVendor(vendor, projectDir, await loadLLMConfig(projectDir));
  cache.set(key, { expiresAt: Date.now() + CATALOG_CACHE_TTL_MS, probe });
  return probe;
}
