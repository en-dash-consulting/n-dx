/**
 * Per-vendor live model list and installed-CLI probe behind GET /api/llm/catalog.
 *
 * Codex CLI uses model/list with a short identity-aware cache. Direct API
 * discovery retains its separate uncached vendor-model path. Neither proves
 * inference access. Claude uses its vendor API.
 */

import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import {
  ClaudeClientError,
  LLM_VENDOR,
  exec,
  listVendorModels,
  listCodexModels,
  loadLLMConfig,
  repoEnvPolicy,
  repoTrustRecordPath,
  resolveGoogleApiKey,
  resolveVendorAuth,
  resolveVendorCliEnv,
} from "@n-dx/llm-client";
import type { LLMConfig, ListableVendor } from "@n-dx/llm-client";
import { isProjectRestricted } from "./trust-gate.js";

/** Claude's live-list/CLI TTL; Codex uses the shorter account-sensitive TTL below. */
export const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
/** CLI/keychain account changes without file signals become visible within a minute. */
export const CODEX_CATALOG_CACHE_TTL_MS = 60_000;
export const CATALOG_FAILURE_TTL_MS = 10_000;
const MAX_CACHE_ENTRIES = 128;

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
  requested: number;
  prepared: number;
  identity?: string;
  expiresAt: number;
  probe?: LiveVendorProbe;
  pending?: Promise<LiveVendorProbe>;
}

const cache = new Map<string, CacheEntry>();

const cacheKey = (projectDir: string, vendor: ListableVendor): string => `${resolve(projectDir)}\0${vendor}`;

/** Retire every cached or pending probe for `projectDir` (after a config save). */
export function clearLlmCatalogCache(projectDir: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${resolve(projectDir)}\0`)) cache.delete(key);
  }
}

/**
 * The binary a run would invoke for `vendor`: `CLAUDE_CLI_PATH`, then the
 * vendor's `cli_path`, else the bare name resolved on PATH. `config` is
 * `loadLLMConfig`'s, which drops a `cli_path` the shared project config sets
 * while the repository is untrusted, so the probe never spawns a binary the
 * repository chose; the user's `.n-dx.local.json` always applies.
 */
function resolveBinary(vendor: ListableVendor, config: LLMConfig): string {
  if (vendor === LLM_VENDOR.CLAUDE) {
    return process.env.CLAUDE_CLI_PATH || config.claude?.cli_path || "claude";
  }
  return config.codex?.cli_path || "codex";
}

/** First `1.2.3`-shaped token in `--version` output (`2.1.0 (Claude Code)`, `codex-cli 0.46.0`). */
function parseVersion(output: string): string | null {
  return /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(output)?.[0] ?? null;
}

/**
 * The environment the vendor's runs get, under the project's own
 * `llm.<vendor>.auth`. `--version` needs no credential, so where `api` has no
 * usable key — the one case `resolveVendorCliEnv` refuses — the probe runs as
 * `cli` instead of failing.
 */
function probeEnv(vendor: ListableVendor, projectDir: string, config: LLMConfig): { env: NodeJS.ProcessEnv; missingKey: boolean } {
  const policy = repoEnvPolicy(projectDir);
  const vendorConfig: LLMConfig = { ...config, vendor };
  try {
    return { env: resolveVendorCliEnv(vendorConfig, policy), missingKey: false };
  } catch (err) {
    if (!(err instanceof ClaudeClientError) || err.reason !== "auth") throw err;
    return { env: resolveVendorCliEnv({ ...vendorConfig, [vendor]: { ...config[vendor], auth: "cli" } }, policy), missingKey: true };
  }
}

interface ProbeContext {
  binary: string;
  env: NodeJS.ProcessEnv;
  missingKey: boolean;
  restricted: boolean;
}

/** Metadata only: credential contents are never read or retained by the cache. */
function fileRevision(path: string): unknown {
  try {
    const stat = statSync(path, { throwIfNoEntry: false });
    return [path, stat ? [realpathSync(path), stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode] : null];
  } catch (err) {
    // Inaccessible and absent inputs are distinct; the live probe reports usability.
    return [path, (err as NodeJS.ErrnoException).code ?? "unreadable"];
  }
}

function codexIdentity(projectDir: string, config: LLMConfig, context: ProbeContext): string {
  const { binary, env, restricted, missingKey } = context;
  const windows = process.platform === "win32";
  // resolveVendorCliEnv returns a plain object, without process.env's Windows
  // case folding. Match the first sorted spelling Node passes to the child.
  const envValue = (name: string): string | undefined => {
    if (!windows) return env[name];
    const key = Object.keys(env).sort().find((key) => key.toUpperCase() === name);
    return key === undefined ? undefined : env[key];
  };
  const home = resolve(projectDir, envValue("CODEX_HOME") || join(envValue("HOME") || envValue("USERPROFILE") || homedir(), ".codex"));
  const files = [join(home, "auth.json"), join(home, "config.toml"), repoTrustRecordPath(projectDir)];
  // Include every project config Codex can inherit, even one created later.
  for (let dir = resolve(projectDir); ; dir = dirname(dir)) {
    files.push(join(dir, ".codex", "config.toml"));
    if (existsSync(join(dir, ".git")) || dirname(dir) === dir) break;
  }
  // Observe PATH candidates as well as the configured path: installation,
  // replacement, permission changes and symlink retargeting all invalidate.
  const path = envValue("PATH") ?? (windows ? "" : "/usr/bin:/bin");
  const dirs = /[/\\]/.test(binary) ? [projectDir] : [
    ...(windows ? [projectDir] : []), ...path.split(delimiter),
  ];
  const extensions = windows ? ["", ...(envValue("PATHEXT") || ".COM;.EXE;.BAT;.CMD").split(";")] : [""];
  for (const dir of dirs) {
    for (const extension of extensions) files.push(resolve(projectDir, dir, binary + extension));
  }
  // Only this digest survives the lookup. Never log secret-bearing config/env.
  return createHash("sha256").update(JSON.stringify([
    config, binary, restricted, missingKey,
    Object.keys(env).sort().map((name) => [name, env[name]]),
    files.map(fileRevision),
  ])).digest("hex");
}

/**
 * `<binary> --version`, with the vendor's filtered environment from
 * `resolveVendorCliEnv` (the agent loop's resolver) under the project's
 * `guard.env` policy from `repoEnvPolicy` (the user's own deny entries, the
 * repository's allow only while trusted), so no credential outside the
 * vendor's mode, and none the user denied, reaches the binary or anything it runs.
 */
async function probeCli(projectDir: string, { binary, env }: ProbeContext): Promise<CliInfo> {
  const result = await exec(binary, ["--version"], { cwd: projectDir, timeout: CLI_PROBE_TIMEOUT_MS, env });
  if (!result.launched || result.exitCode !== 0) return { found: false, version: null, path: null };
  return { found: true, version: parseVersion(result.stdout) ?? parseVersion(result.stderr), path: binary };
}

/** Direct API discovery retains its credential-safe uncached path, independent of CLI settings. */
async function probeCodexApi(config: LLMConfig): Promise<LiveVendorProbe> {
  // Catalog probes only contact the public vendor URL. A custom endpoint's
  // credential belongs to that endpoint and cannot be used for this probe.
  if (config.codex?.api_endpoint && config.codex.api_endpoint.replace(/\/+$/, "") !== "https://api.openai.com/v1") {
    return {
      listing: { ok: false, reason: "Live discovery is unavailable for custom OpenAI endpoints." },
      checkedAt: new Date().toISOString(), cli: { found: false, version: null, path: null },
    };
  }
  const auth = resolveVendorAuth(LLM_VENDOR.CODEX, config);
  const listing: LiveVendorProbe["listing"] = auth.mode === "api" && auth.key
    ? await listVendorModels(LLM_VENDOR.CODEX, { ...config, codex: { ...config.codex, api_key: auth.key.value } })
    : { ok: false, reason: "OpenAI API key unavailable under llm.codex.auth; configure API authentication before refreshing." };
  return { listing, checkedAt: new Date().toISOString(), cli: { found: false, version: null, path: null } };
}

/**
 * Probe the binary and filtered environment captured for this lookup. The
 * loader clamps untrusted binary settings. Codex model/list also requires
 * repository trust because app-server loads project config; Claude's listing
 * uses the vendor's own models URL, never a configured api_endpoint.
 */
async function probeVendor(
  vendor: ListableVendor,
  projectDir: string,
  config: LLMConfig,
  context: ProbeContext,
): Promise<LiveVendorProbe> {
  if (vendor === LLM_VENDOR.CODEX) {
    const cli = await probeCli(projectDir, context);
    let listing: LiveVendorProbe["listing"];
    if (context.restricted || isProjectRestricted(projectDir)) {
      listing = { ok: false, reason: "Codex catalog not probed: accept this checkout with n-dx trust accept . before refreshing." };
    } else if (!cli.found) {
      listing = { ok: false, reason: "Codex CLI unavailable; check llm.codex.cli_path, install or update Codex, then refresh." };
    } else if (context.missingKey) {
      listing = { ok: false, reason: "Codex API authentication is configured without a key; configure the key or select CLI login, then refresh." };
    } else {
      listing = await listCodexModels({ binary: context.binary, cwd: projectDir, env: context.env });
    }
    return { listing, checkedAt: new Date().toISOString(), cli };
  }
  const [listing, cli] = await Promise.all([
    listVendorModels(vendor, config),
    probeCli(projectDir, context),
  ]);
  return { listing, checkedAt: new Date().toISOString(), cli };
}

/**
 * The live list and CLI probe for `vendor`, from cache while fresh.
 * Concurrent lookups of one identity share both CLI and catalog probes.
 * `refresh` retires the cached/pending entry before any asynchronous work;
 * clearing, eviction and refresh cannot be undone by an older completion.
 */
export async function getLiveVendorProbe(
  vendor: ListableVendor,
  projectDir: string,
  options: { refresh?: boolean; provider?: "cli" | "api" } = {},
): Promise<LiveVendorProbe> {
  // API discovery must neither reuse a CLI catalog nor inspect native CLI config.
  if (vendor === LLM_VENDOR.CODEX && options.provider === "api") {
    return probeCodexApi(await loadLLMConfig(projectDir));
  }
  const key = cacheKey(projectDir, vendor);
  let entry = options.refresh ? undefined : cache.get(key);
  if (!entry) entry = { requested: 0, prepared: 0, expiresAt: 0 };
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);

  const request = ++entry.requested;
  const config = await loadLLMConfig(projectDir);
  // A slow config read must not restore an identity a newer lookup retired.
  if (cache.get(key) === entry && request < entry.prepared) return getLiveVendorProbe(vendor, projectDir);
  entry.prepared = request;
  const context = { binary: resolveBinary(vendor, config), ...probeEnv(vendor, projectDir, config), restricted: isProjectRestricted(projectDir) };
  const identity = vendor === LLM_VENDOR.CODEX ? codexIdentity(projectDir, config, context) : String(context.restricted);
  if (entry.identity !== identity) {
    entry.identity = identity;
    entry.probe = undefined;
    entry.pending = undefined;
  }
  if (entry.probe && entry.expiresAt > Date.now()) return entry.probe;
  if (entry.pending) return entry.pending;

  const pending = probeVendor(vendor, projectDir, config, context);
  entry.pending = pending;
  try {
    const probe = await pending;
    if (cache.get(key) === entry && entry.pending === pending) {
      const ttl = vendor === LLM_VENDOR.CODEX
        ? (probe.listing.ok ? CODEX_CATALOG_CACHE_TTL_MS : CATALOG_FAILURE_TTL_MS)
        : CATALOG_CACHE_TTL_MS;
      entry.probe = probe;
      entry.expiresAt = Date.now() + ttl;
    }
    return probe;
  } finally {
    if (entry.pending === pending) entry.pending = undefined;
  }
}

/** Whether a vendor can run as configured, with the line its card shows as-is. */
export interface VendorReadiness {
  state: "ready" | "needs-setup" | "unreachable";
  summary: string;
  /** Whether an API key resolves. Presence only: the key never leaves the server. Omitted where no key applies. */
  apiKey?: boolean;
}

const cliReadiness = (cli: CliInfo): VendorReadiness =>
  cli.found
    ? { state: "ready", summary: cli.version ? `Ready · CLI ${cli.version}` : "Ready · CLI" }
    : { state: "needs-setup", summary: "CLI not found" };

const apiKeyReadiness = (hasKey: boolean): VendorReadiness =>
  hasKey
    ? { state: "ready", summary: "Ready · API key set", apiKey: true }
    : { state: "needs-setup", summary: "API key missing", apiKey: false };

/**
 * Claude's readiness on the provider `ndx work` would run it on: the CLI probe
 * for `cli`, a resolved API key for `api`. `apiKey` is reported either way.
 */
export function claudeReadiness(
  provider: "cli" | "api",
  cli: CliInfo,
  config: LLMConfig,
): VendorReadiness {
  // A key `llm.claude.auth` lets an API run use: a stored key counts only
  // under `api`, as hench and the client factory count it.
  const auth = resolveVendorAuth(LLM_VENDOR.CLAUDE, config);
  const hasKey = auth.mode === "api" && auth.key !== undefined;
  if (provider === "api") return apiKeyReadiness(hasKey);
  return { ...cliReadiness(cli), apiKey: hasKey };
}

/** Direct OpenAI execution needs an API key; CLI execution keeps its own readiness. */
export function codexReadiness(cli: CliInfo, provider = "cli", config: LLMConfig = {}): VendorReadiness {
  if (provider !== "api") return cliReadiness(cli);
  const auth = resolveVendorAuth(LLM_VENDOR.CODEX, config);
  return apiKeyReadiness(auth.mode === "api" && auth.key !== undefined);
}

/** Gemini runs on the API alone, from `llm.google.api_key` or `GEMINI_API_KEY` (config never carries an env-var name). */
export function googleReadiness(config: LLMConfig): VendorReadiness {
  return apiKeyReadiness(Boolean(resolveGoogleApiKey(config.google)));
}

/**
 * The local server is ready when it answers; `address` is `host:port`.
 *
 * `shapeError` is the message the saved host or port failed the shape check
 * with. That endpoint was never contacted, so it is a configuration to fix,
 * not a connection that failed: the card says `needs-setup` and carries the
 * shape error as its line, where `unreachable · host:port` would claim a
 * server that was never probed.
 */
export function localReadiness(reachable: boolean, address: string, shapeError: string | null = null): VendorReadiness {
  if (shapeError) return { state: "needs-setup", summary: shapeError };
  return reachable
    ? { state: "ready", summary: `Ready · ${address}` }
    : { state: "unreachable", summary: `Not reachable · ${address}` };
}
