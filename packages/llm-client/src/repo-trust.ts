/**
 * Repository trust: what a checkout brought with it, and whether this user
 * has agreed to run under it.
 *
 * Several files that n-dx reads to decide *what it may execute* live inside
 * the repository and are usually tracked by git: the hench guard in
 * `.hench/config.json` (command allowlist, blocked paths, git subcommands,
 * permission mode), the test command in `.rex/config.json`, and the MCP
 * servers in `.mcp.json`. A clone, a fork, or a checked-out pull request can
 * therefore ship a *looser* policy than the one the user's own `ndx init`
 * would have written, and nothing used to say so.
 *
 * This module gives every entry point one answer:
 *
 * - {@link collectRepoExecutionConfig} reads those files and reduces them to
 *   the execution-relevant subset plus a content digest.
 * - {@link assessRepoExecutionConfig} compares that subset to the guard
 *   baseline for the project's language and lists what is *wider* than the
 *   baseline. Narrower is never a finding.
 * - {@link evaluateRepoTrust} adds the user's own trust record, kept outside
 *   the repository in `<ndx home>/trust/`, and decides the state: `baseline`
 *   (nothing to trust), `trusted` (digest matches the record), `untrusted`
 *   (deviates, never trusted), or `changed` (deviates, and the record was
 *   for a different digest).
 * - {@link recordRepoTrust} writes the record for the current digest; the
 *   file is mode 0600 in a 0700 directory, so another account on the machine
 *   cannot pre-approve a repository for this one.
 * - {@link clampGuardToBaseline} is what a caller applies while a repository
 *   is not trusted: the allowlists intersect with the baseline and the
 *   blocked paths union with it, so an untrusted checkout can only ever
 *   *tighten* what the user's defaults allow.
 *
 * The trust store is deliberately a plain file for now. It records a
 * decision, not a secret; an encrypted store is a later concern.
 *
 * Foundation-tier and dependency-free beyond node built-ins, so hench (via
 * its gateway), the web server and the CLI all evaluate the same way.
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, sep } from "node:path";
import { resolveLayout, resolveNdxHome, type ResolveNdxHomeOptions } from "./layout.js";
import { toCanonicalJSON } from "./json.js";

// ── Baseline ────────────────────────────────────────────────────────────────

/** The parts of a hench guard that widen or narrow what an agent may do. */
export interface GuardBaseline {
  allowedCommands: string[];
  blockedPaths: string[];
  allowedGitSubcommands: string[];
}

/**
 * Files that hold credentials more often than not. Blocked by default for
 * every language; a repository that wants an agent to read them must say so
 * in a configuration the user has trusted.
 */
export const SECRET_PATH_PATTERNS: readonly string[] = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.keystore",
  "**/id_rsa*",
  "**/id_ed25519*",
  ".npmrc",
  ".netrc",
  "**/.aws/**",
  "**/.ssh/**",
];

/** Git subcommands every language baseline allows. */
export const GIT_SUBCOMMAND_BASELINE: readonly string[] = [
  "status", "add", "commit", "diff", "log",
  "branch", "checkout", "stash", "show", "rev-parse",
];

/** Project-state directories every baseline keeps the agent out of. */
const CORE_BLOCKED = [".hench/**", ".rex/**", ".git/**"];

const LANGUAGE_BASELINES: Record<string, Pick<GuardBaseline, "allowedCommands"> & { extraBlocked: string[] }> = {
  typescript: {
    allowedCommands: ["npm", "npx", "node", "git", "tsc", "vitest"],
    extraBlocked: ["node_modules/**"],
  },
  javascript: {
    allowedCommands: ["npm", "npx", "node", "git", "tsc", "vitest"],
    extraBlocked: ["node_modules/**"],
  },
  go: {
    allowedCommands: ["go", "make", "git", "golangci-lint"],
    extraBlocked: ["vendor/**"],
  },
  swift: {
    allowedCommands: ["swift", "make", "xcodebuild", "xcrun", "git"],
    extraBlocked: [".build/**", "DerivedData/**", "Pods/**", "Carthage/**"],
  },
};

/**
 * The guard baseline for a project language. Unknown or missing languages
 * get the JS/TS baseline, matching hench's own defaults.
 */
export function guardBaselineForLanguage(language?: string | null): GuardBaseline {
  const entry = LANGUAGE_BASELINES[language ?? ""] ?? LANGUAGE_BASELINES.typescript;
  return {
    allowedCommands: [...entry.allowedCommands],
    blockedPaths: [...CORE_BLOCKED, ...entry.extraBlocked, ...SECRET_PATH_PATTERNS],
    allowedGitSubcommands: [...GIT_SUBCOMMAND_BASELINE],
  };
}

/**
 * Narrow a guard to the baseline: allowlists intersect, blocked paths union.
 * Everything else on the guard is returned untouched. The result is never
 * wider than the baseline on any of the three axes.
 */
export function clampGuardToBaseline<T extends GuardBaseline>(guard: T, baseline: GuardBaseline): T {
  const allowedCommands = guard.allowedCommands.filter((c) => baseline.allowedCommands.includes(c));
  const allowedGitSubcommands = guard.allowedGitSubcommands.filter((s) => baseline.allowedGitSubcommands.includes(s));
  const blockedPaths = [...new Set([...guard.blockedPaths, ...baseline.blockedPaths])];
  return { ...guard, allowedCommands, allowedGitSubcommands, blockedPaths };
}

// ── Collection ──────────────────────────────────────────────────────────────

/** One MCP server as `.mcp.json` declares it, reduced to what gets executed. */
export interface RepoMcpServer {
  name: string;
  command: string | null;
  args: string[];
  /** HTTP servers carry a URL instead of a command. */
  url: string | null;
}

/** The execution-relevant subset of what the repository ships. */
export interface RepoExecutionConfig {
  /** Which files were read, relative to the project root. Absent files are omitted. */
  sources: string[];
  language: string | null;
  guard: GuardBaseline | null;
  permissionMode: string | null;
  provider: string | null;
  /** `.rex/config.json` → `test`. */
  testCommand: string | null;
  mcpServers: RepoMcpServer[];
  /** sha256 over the canonical JSON of everything above except `sources`. */
  digest: string;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? [...(value as string[])] : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function relOf(root: string, path: string): string {
  if (!path.startsWith(root)) return path;
  // Forward slashes, not the platform separator. These strings are shown to
  // the user ("Read from: …") and recorded in the trust file, so a Windows
  // `.hench\config.json` would make the same checkout read differently — and
  // compare differently — from one on Linux. Split on `sep` rather than a
  // blanket backslash replace: on POSIX a backslash is a legal filename character.
  return path.slice(root.length).replace(/^[\\/]/, "").split(sep).join("/");
}

/**
 * Read the repository's execution-relevant configuration.
 *
 * Hench overrides in the project config file (`.n-dx.json`, or the `.ndx/`
 * container's `config.json`) are folded over `.hench/config.json` the way
 * hench's own loader folds them, because that file is often tracked too. The
 * user's `.n-dx.local.json` is not read: it is git-ignored and theirs.
 */
export function collectRepoExecutionConfig(projectDir: string): RepoExecutionConfig {
  const layout = resolveLayout(projectDir);
  const root = layout.root;
  const sources: string[] = [];

  const henchConfigPath = join(layout.henchDir, "config.json");
  const henchConfig = readJson(henchConfigPath);
  if (henchConfig) sources.push(relOf(root, henchConfigPath));

  const projectConfig = readJson(layout.configFile);
  const projectHench = projectConfig && typeof projectConfig.hench === "object" && projectConfig.hench && !Array.isArray(projectConfig.hench)
    ? (projectConfig.hench as Record<string, unknown>)
    : null;
  if (projectHench) sources.push(relOf(root, layout.configFile));

  const merged: Record<string, unknown> = { ...(henchConfig ?? {}), ...(projectHench ?? {}) };
  const rawGuard = merged.guard && typeof merged.guard === "object" && !Array.isArray(merged.guard)
    ? (merged.guard as Record<string, unknown>)
    : null;
  const guard: GuardBaseline | null = rawGuard
    ? {
        allowedCommands: stringArray(rawGuard.allowedCommands) ?? [],
        blockedPaths: stringArray(rawGuard.blockedPaths) ?? [],
        allowedGitSubcommands: stringArray(rawGuard.allowedGitSubcommands) ?? [],
      }
    : null;

  const rexConfigPath = join(layout.rexDir, "config.json");
  const rexConfig = readJson(rexConfigPath);
  if (rexConfig) sources.push(relOf(root, rexConfigPath));

  const mcpPath = join(root, ".mcp.json");
  const mcpConfig = readJson(mcpPath);
  const mcpServers: RepoMcpServer[] = [];
  if (mcpConfig) {
    sources.push(".mcp.json");
    const servers = mcpConfig.mcpServers;
    if (servers && typeof servers === "object" && !Array.isArray(servers)) {
      for (const [name, raw] of Object.entries(servers as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
        const s = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
        mcpServers.push({
          name,
          command: optionalString(s.command),
          args: stringArray(s.args) ?? [],
          url: optionalString(s.url),
        });
      }
    }
  }

  const body = {
    language: optionalString(merged.language),
    guard: guard
      ? {
          allowedCommands: [...guard.allowedCommands].sort(),
          blockedPaths: [...guard.blockedPaths].sort(),
          allowedGitSubcommands: [...guard.allowedGitSubcommands].sort(),
        }
      : null,
    permissionMode: optionalString(merged.permissionMode),
    provider: optionalString(merged.provider),
    testCommand: optionalString(rexConfig?.test),
    mcpServers,
  };

  return {
    sources,
    ...body,
    guard,
    digest: createHash("sha256").update(toCanonicalJSON(body)).digest("hex"),
  };
}

// ── Assessment ──────────────────────────────────────────────────────────────

export type RepoTrustFindingCode =
  | "commands-added"
  | "blocked-paths-removed"
  | "git-subcommands-added"
  | "permission-bypass"
  | "test-command"
  | "mcp-servers"
  | "secret-paths-unblocked";

export interface RepoTrustFinding {
  code: RepoTrustFindingCode;
  /** `warning` widens what may execute and makes the repository deviate; `info` is shown but does not. */
  severity: "warning" | "info";
  message: string;
  /** The concrete values behind the message, for a UI that wants to list them. */
  values: string[];
}

const SHELL_RISK = /[;&|`$]|\b(curl|wget|sh -c|bash -c|powershell|iex\b|Invoke-Expression)\b/i;

/** The MCP server commands `ndx init` writes, which need no review. */
function isNdxMcpServer(server: RepoMcpServer): boolean {
  if (server.url) return false;
  const cmd = server.command ?? "";
  const args = server.args;
  const isNdxBin = cmd === "ndx" || cmd === "n-dx";
  const viaNpx = cmd === "npx" && args[0] === "-y" && args[1] === "@n-dx/core";
  const tail = viaNpx ? args.slice(2) : args;
  const tool = tail[0];
  return (isNdxBin || viaNpx)
    && tail[1] === "mcp"
    && (tool === "rex" || tool === "sv" || tool === "sourcevision")
    && tail.length === 3;
}

function coversDir(blocked: string[], dir: string): boolean {
  // `.hench/**`, `**/.hench/**` and the container layout's `.ndx/hench/**` or
  // `.ndx/**` all keep the agent out of hench state.
  const bare = dir.replace(/^\./, "");
  const re = new RegExp(`(^|/)\\.?${bare}/\\*\\*$`);
  return blocked.some((p) => {
    const n = p.replace(/\\/g, "/");
    return n === ".ndx/**" || re.test(n);
  });
}

/**
 * List how the repository's configuration is wider than the baseline for its
 * language. Narrower is not reported. A missing guard means the repository
 * left hench's defaults in force, which is the baseline by definition.
 */
export function assessRepoExecutionConfig(config: RepoExecutionConfig): RepoTrustFinding[] {
  const baseline = guardBaselineForLanguage(config.language);
  const findings: RepoTrustFinding[] = [];

  if (config.guard) {
    const added = config.guard.allowedCommands.filter((c) => !baseline.allowedCommands.includes(c));
    if (added.length) {
      findings.push({
        code: "commands-added",
        severity: "warning",
        message: `Allows the agent to run commands outside the ${config.language ?? "default"} baseline: ${added.join(", ")}`,
        values: added,
      });
    }

    const removed = ["hench", "rex", ".git"].filter((d) => !coversDir(config.guard!.blockedPaths, d));
    if (removed.length) {
      findings.push({
        code: "blocked-paths-removed",
        severity: "warning",
        message: `Lets the agent write to project state it is normally kept out of: ${removed.map((d) => (d === ".git" ? ".git/" : `.${d}/`)).join(", ")}`,
        values: removed,
      });
    }

    const gitAdded = config.guard.allowedGitSubcommands.filter((s) => !baseline.allowedGitSubcommands.includes(s));
    if (gitAdded.length) {
      findings.push({
        code: "git-subcommands-added",
        severity: "warning",
        message: `Allows git subcommands outside the baseline: ${gitAdded.join(", ")}`,
        values: gitAdded,
      });
    }

    const hasSecretBlock = config.guard.blockedPaths.some((p) => p === ".env" || p === "**/.env" || p === ".env*" || p === "**/.env*");
    if (!hasSecretBlock) {
      findings.push({
        code: "secret-paths-unblocked",
        severity: "info",
        message: "Does not block credential files (.env, keys); the current defaults do. Blocked anyway until trusted.",
        values: [],
      });
    }
  }

  if (config.permissionMode === "bypassPermissions") {
    findings.push({
      code: "permission-bypass",
      severity: "warning",
      message: "Runs the vendor CLI with bypassPermissions, so the agent's own tool calls are never confirmed",
      values: ["bypassPermissions"],
    });
  }

  if (config.testCommand) {
    const risky = SHELL_RISK.test(config.testCommand);
    findings.push({
      code: "test-command",
      severity: risky ? "warning" : "info",
      message: risky
        ? `Defines a test command that chains or fetches: ${config.testCommand}`
        : `Defines the test command n-dx runs for verification: ${config.testCommand}`,
      values: [config.testCommand],
    });
  }

  const foreign = config.mcpServers.filter((s) => !isNdxMcpServer(s));
  if (foreign.length) {
    const shown = foreign.map((s) => `${s.name}: ${s.url ?? [s.command ?? "?", ...s.args].join(" ")}`);
    findings.push({
      code: "mcp-servers",
      severity: "warning",
      message: `Declares MCP servers that are not the ones ndx writes, which an assistant may start: ${shown.join("; ")}`,
      values: shown,
    });
  }

  return findings;
}

// ── Inventory ───────────────────────────────────────────────────────────────

/** What else the checkout brought, for the review a user sees at init. */
export interface RepoInventory {
  prd: { items: number; epics: number } | null;
  analysis: { analyzedAt: string | null; version: string | null } | null;
  henchRuns: number | null;
}

function countPrdTree(treeDir: string): { items: number; epics: number } | null {
  if (!existsSync(treeDir)) return null;
  let items = 0;
  let epics = 0;
  const walk = (dir: string, depth: number): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      if (existsSync(join(full, "index.md"))) {
        items += 1;
        if (depth === 0) epics += 1;
      }
      walk(full, depth + 1);
    }
  };
  walk(treeDir, 0);
  return { items, epics };
}

export function collectRepoInventory(projectDir: string): RepoInventory {
  const layout = resolveLayout(projectDir);
  const prd = countPrdTree(join(layout.rexDir, "prd_tree"));
  const manifest = readJson(join(layout.sourcevisionDir, "manifest.json"));
  const analysis = manifest
    ? {
        analyzedAt: optionalString(manifest.analyzedAt) ?? optionalString(manifest.generatedAt) ?? optionalString(manifest.timestamp),
        version: optionalString(manifest.version),
      }
    : null;
  let henchRuns: number | null = null;
  try {
    henchRuns = readdirSync(join(layout.henchDir, "runs")).filter((f) => f.endsWith(".json")).length;
  } catch {
    henchRuns = null;
  }
  return { prd, analysis, henchRuns };
}

// ── Trust store ─────────────────────────────────────────────────────────────

export interface RepoTrustRecord {
  version: 1;
  projectDir: string;
  digest: string;
  trustedAt: string;
}

export interface RepoTrustStoreOptions extends ResolveNdxHomeOptions {
  /** Override the per-user directory entirely (tests). */
  ndxHome?: string;
}

function trustDir(options: RepoTrustStoreOptions): string {
  return join(options.ndxHome ?? resolveNdxHome(options), "trust");
}

function projectKey(projectDir: string): string {
  let real = projectDir;
  try {
    real = realpathSync(projectDir);
  } catch {
    // An unresolvable path still gets a stable key.
  }
  return createHash("sha256").update(real).digest("hex").slice(0, 24);
}

/** Path of the trust record this project would have, whether or not it exists. */
export function repoTrustRecordPath(projectDir: string, options: RepoTrustStoreOptions = {}): string {
  return join(trustDir(options), `${projectKey(projectDir)}.json`);
}

export function readRepoTrustRecord(projectDir: string, options: RepoTrustStoreOptions = {}): RepoTrustRecord | null {
  const raw = readJson(repoTrustRecordPath(projectDir, options));
  if (!raw || raw.version !== 1 || typeof raw.digest !== "string" || typeof raw.trustedAt !== "string") return null;
  return { version: 1, projectDir: String(raw.projectDir ?? projectDir), digest: raw.digest, trustedAt: raw.trustedAt };
}

/**
 * Record that this user trusts the repository's current execution
 * configuration. Mode 0600 in a 0700 directory; on Windows the modes are
 * advisory and the per-user profile directory is the boundary.
 */
export function recordRepoTrust(projectDir: string, options: RepoTrustStoreOptions = {}): RepoTrustRecord {
  const config = collectRepoExecutionConfig(projectDir);
  const dir = trustDir(options);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Not every filesystem honours modes; the directory still exists.
  }
  const record: RepoTrustRecord = {
    version: 1,
    projectDir,
    digest: config.digest,
    trustedAt: new Date().toISOString(),
  };
  const path = repoTrustRecordPath(projectDir, options);
  writeFileSync(path, toCanonicalJSON(record), { encoding: "utf-8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // See above.
  }
  return record;
}

/** Forget a trust decision. Returns whether a record existed. */
export function clearRepoTrust(projectDir: string, options: RepoTrustStoreOptions = {}): boolean {
  const path = repoTrustRecordPath(projectDir, options);
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

// ── Evaluation ──────────────────────────────────────────────────────────────

export type RepoTrustState = "baseline" | "trusted" | "untrusted" | "changed";

export interface RepoTrustEvaluation {
  state: RepoTrustState;
  /** True when a caller should clamp the guard and warn: `untrusted` or `changed`. */
  restricted: boolean;
  config: RepoExecutionConfig;
  findings: RepoTrustFinding[];
  inventory: RepoInventory;
  record: RepoTrustRecord | null;
  trustFile: string;
}

/**
 * Evaluate a repository against the user's trust store.
 *
 * A repository with no `warning` findings is `baseline` whatever the store
 * says: there is nothing to trust, and a stale record for it is harmless. A
 * deviating repository is `trusted` when the record matches its digest,
 * `changed` when the record is for another digest, and `untrusted` with no
 * record at all.
 */
export function evaluateRepoTrust(projectDir: string, options: RepoTrustStoreOptions = {}): RepoTrustEvaluation {
  const config = collectRepoExecutionConfig(projectDir);
  const findings = assessRepoExecutionConfig(config);
  const inventory = collectRepoInventory(projectDir);
  const record = readRepoTrustRecord(projectDir, options);
  const deviates = findings.some((f) => f.severity === "warning");

  let state: RepoTrustState;
  if (!deviates) state = "baseline";
  else if (record && record.digest === config.digest) state = "trusted";
  else if (record) state = "changed";
  else state = "untrusted";

  return {
    state,
    restricted: state === "untrusted" || state === "changed",
    config,
    findings,
    inventory,
    record,
    trustFile: repoTrustRecordPath(projectDir, options),
  };
}

// ── Reporting ───────────────────────────────────────────────────────────────

export interface RepoTrustReportOptions {
  /** The command a user runs to trust the repository; defaults to `ndx trust accept .`. */
  acceptCommand?: string;
  /** Include the PRD/analysis inventory lines (the init review wants them; a run warning does not). */
  inventory?: boolean;
}

/**
 * Plain-text lines describing an evaluation, shared by every CLI surface so
 * the wording cannot drift. No colour; callers decorate.
 */
export function formatRepoTrustReport(ev: RepoTrustEvaluation, options: RepoTrustReportOptions = {}): string[] {
  const accept = options.acceptCommand ?? "ndx trust accept .";
  const lines: string[] = [];
  const warnings = ev.findings.filter((f) => f.severity === "warning");
  const infos = ev.findings.filter((f) => f.severity === "info");

  switch (ev.state) {
    case "baseline":
      lines.push("Repository execution config: matches the defaults (nothing to trust).");
      break;
    case "trusted":
      lines.push(`Repository execution config: trusted by you on ${ev.record?.trustedAt ?? "?"}.`);
      break;
    case "untrusted":
      lines.push("Repository execution config: NOT TRUSTED. This checkout widens what n-dx may execute.");
      break;
    case "changed":
      lines.push("Repository execution config: CHANGED since you trusted it. Review the differences again.");
      break;
  }

  if (ev.config.sources.length) lines.push(`  Read from: ${ev.config.sources.join(", ")}`);
  for (const f of warnings) lines.push(`  ! ${f.message}`);
  for (const f of infos) lines.push(`  - ${f.message}`);

  if (options.inventory) {
    const inv = ev.inventory;
    if (inv.prd) lines.push(`  PRD: ${inv.prd.items} item(s) in ${inv.prd.epics} epic(s) came with the checkout. Review them before an autonomous run.`);
    if (inv.analysis) lines.push(`  Analysis: SourceVision output present${inv.analysis.analyzedAt ? ` (${inv.analysis.analyzedAt})` : ""}.`);
    if (inv.henchRuns) lines.push(`  Runs: ${inv.henchRuns} hench run record(s) present.`);
  }

  if (ev.restricted) {
    lines.push("  Until trusted, hench runs with the default guard (the repository's config can only tighten it),");
    lines.push("  bypassPermissions is lowered to acceptEdits, and verify_criteria does not run the test command.");
    lines.push(`  To accept this configuration: ${accept}`);
  }
  return lines;
}
