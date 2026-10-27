/**
 * Repository trust: what a checkout brought with it, and whether this user
 * has agreed to run under it.
 *
 * Several files that n-dx reads to decide *what it may execute* live inside
 * the repository and are usually tracked by git: the hench guard in
 * `.hench/config.json` (command allowlist, blocked paths, git subcommands,
 * permission mode, the child-environment allowlist), the test command in
 * `.rex/config.json`, and the MCP
 * servers in `.mcp.json`. A clone, a fork, or a checked-out pull request can
 * therefore ship a *looser* policy than the one the user's own `ndx init`
 * would have written, and nothing used to say so.
 *
 * This module gives every entry point one answer:
 *
 * - {@link collectRepoExecutionConfig} reads those files and reduces them to
 *   the execution-relevant subset plus a content digest.
 * - {@link assessRepoExecutionConfig} compares that subset to the guard
 *   baseline for the language {@link detectRepoLanguage} reads from marker
 *   files, and lists what is *wider* than the baseline. Narrower is never a
 *   finding. The `language` the repository declares never picks the
 *   baseline: a JS checkout declaring `swift` would otherwise get
 *   `xcodebuild` and `xcrun` for free. A declared language that disagrees
 *   with the detected one is a finding of its own.
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
 * `guard.env.allow` names variables child processes may keep, so an entry
 * the repository ships (`.hench/config.json`, the project config's `hench`
 * section) widens what a model-chosen command can read. While the repository
 * is not trusted those entries are dropped everywhere: from the agent's shell
 * (hench's `applyRepoTrust`) and from repository-owned commands such as the
 * test gate, post-task tests, the dependency audit and rex's verify command
 * (`repoCommandEnv`). An operator who needs a credential in their own tests
 * puts it in the git-ignored `.n-dx.local.json`, whose entries always apply,
 * or accepts the checkout. `deny` entries only remove, so they always apply.
 *
 * "Git-ignored" is checked, not assumed: a repository can commit its own
 * `.n-dx.local.json`. {@link isLocalConfigTracked} says whether it did, and
 * every reader that applies the local file regardless of trust asks it first
 * (see {@link userLocalConfigApplies}). A tracked local file is repository
 * config: it is collected here, raises `local-config-tracked`, and applies
 * only once the checkout is trusted. Outside a git work tree nothing is
 * tracked, so the local file is the user's, as before; inside one, a git that
 * cannot answer counts the file as tracked.
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
  writeFileSync,
  type Dirent,
} from "node:fs";
import { join, sep } from "node:path";
import {
  NDX_CONTAINER_DIRNAME,
  relativeToRoot,
  resolveLayout,
  resolveNdxHome,
  type ResolveNdxHomeOptions,
} from "./layout.js";
import { gitTracksPath, insideGitWorkTree } from "./exec.js";
import { toCanonicalJSON } from "./json.js";
import { deepMerge } from "./project-config.js";

/**
 * The legacy layout's paths, resolved once by name.
 *
 * `"."` as the root is not a lookup — an explicit `mode` skips detection, so
 * nothing touches the disk and what comes back is purely the names. Used only
 * to spell the two directories in {@link CORE_BLOCKED} without writing them
 * out here.
 */
const LEGACY_LAYOUT = resolveLayout(".", { mode: "legacy" });

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

/**
 * Project-state directories every baseline keeps the agent out of.
 *
 * Both layouts, because this is matched against whatever path the agent asks
 * to write: the legacy directories, and the container that holds all three on
 * a migrated project. Only the legacy spellings were listed before, so on a
 * `.ndx/` project the guard let the agent write n-dx's own state — the PRD
 * tree included — which is the one thing every baseline is supposed to forbid.
 *
 * `.git/**` stays spelled out: it is git's directory, not one the layout
 * resolver owns.
 */
const CORE_BLOCKED = [
  `${relativeToRoot(LEGACY_LAYOUT, LEGACY_LAYOUT.henchDir)}/**`,
  `${relativeToRoot(LEGACY_LAYOUT, LEGACY_LAYOUT.rexDir)}/**`,
  ".git/**",
  `${NDX_CONTAINER_DIRNAME}/**`,
];

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
 * Every language's dependency directories, blocked by every baseline.
 *
 * The baseline is chosen from marker files, which are repository content, and
 * the clamp unions blocked paths. Were these per-language, a zero-byte
 * `Package.swift` in a JS checkout — or a polyglot's root `go.mod` — would
 * drop `node_modules/**` from what an untrusted checkout is kept out of, and a
 * payload written there runs at the operator's next `npm install`.
 *
 * At any depth, as {@link SECRET_PATH_PATTERNS} are: hench's guard anchors a
 * pattern at the project root, and a workspace package's or a polyglot
 * frontend's `node_modules` runs at the next install as the root's does.
 * `extraBlocked` keeps the root-anchored spelling, which is what `ndx init`
 * wrote before this and what the own-ecosystem check still accepts.
 */
const DEPENDENCY_BLOCKED: readonly string[] = [
  ...new Set(Object.values(LANGUAGE_BASELINES).flatMap((b) => b.extraBlocked.map((p) => `**/${p}`))),
];

/**
 * The guard baseline for a project language. Unknown or missing languages
 * get the JS/TS baseline, matching hench's own defaults. Only the allowed
 * commands depend on the language; blocked paths are the same for all.
 */
export function guardBaselineForLanguage(language?: string | null): GuardBaseline {
  const entry = LANGUAGE_BASELINES[language ?? ""] ?? LANGUAGE_BASELINES.typescript;
  return {
    allowedCommands: [...entry.allowedCommands],
    blockedPaths: [...CORE_BLOCKED, ...DEPENDENCY_BLOCKED, ...SECRET_PATH_PATTERNS],
    allowedGitSubcommands: [...GIT_SUBCOMMAND_BASELINE],
  };
}

/** The languages {@link detectRepoLanguage} can report; one per baseline. */
export type DetectedRepoLanguage = "go" | "swift" | "typescript";

/**
 * The project language as the host sees it, from marker files alone:
 * `go.mod` → go; `Package.swift` or a top-level `*.xcodeproj` /
 * `*.xcworkspace` directory → swift; otherwise the JS/TS default.
 *
 * Mirrors hench init's detection without its config override, because the
 * config is the repository's own claim and this is what checks it.
 */
export function detectRepoLanguage(projectDir: string): DetectedRepoLanguage {
  if (existsSync(join(projectDir, "go.mod"))) return "go";
  if (existsSync(join(projectDir, "Package.swift"))) return "swift";
  let entries: Dirent[];
  try {
    entries = readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return "typescript";
  }
  const xcode = entries.some(
    (e) => e.isDirectory() && (e.name.endsWith(".xcodeproj") || e.name.endsWith(".xcworkspace")),
  );
  return xcode ? "swift" : "typescript";
}

/** The baseline a declared language names, or null when it names none. */
function declaredLanguageFamily(language: string | null): DetectedRepoLanguage | null {
  if (language === "typescript" || language === "javascript") return "typescript";
  if (language === "go" || language === "swift") return language;
  return null;
}

function languageLabel(language: DetectedRepoLanguage): string {
  return language === "typescript" ? "JavaScript/TypeScript" : language;
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
  /** The language the repository declares. Reported, never used as the baseline. */
  language: string | null;
  /**
   * The language {@link detectRepoLanguage} reads from marker files: the
   * baseline every comparison and clamp uses. Not in the digest, because it
   * is the host's reading rather than configuration the user accepts.
   */
  detectedLanguage: DetectedRepoLanguage;
  guard: GuardBaseline | null;
  /**
   * `guard.env.allow` as the repository ships it — names the agent's child
   * processes may keep even when the credential filter would strip them.
   *
   * Only `allow` is collected. `deny` can only remove variables, so a
   * repository cannot use it to reach a credential, and putting it in the
   * digest would re-prompt the user for a change that never widens anything.
   */
  envAllow: string[];
  /**
   * `guard.env.deny` as the repository ships it. Not in the digest — it can
   * only remove variables — but collected so a repository-command environment
   * applies the same policy the agent's shell does.
   */
  envDeny: string[];
  /**
   * The project config's {@link CREDENTIAL_ROUTING_FIELDS} that are set, as
   * `path = value`, sorted: where an API key is sent, and which variable is
   * sent as one.
   */
  credentialRouting: string[];
  /**
   * The project config's {@link VENDOR_CLI_PATH_FIELDS} that are set, and a
   * hench `claudePath` other than the bare `claude`, as `path = value`,
   * sorted: the vendor CLI binary n-dx spawns.
   */
  vendorCliPaths: string[];
  permissionMode: string | null;
  provider: string | null;
  /** The project config's `rex.test`, else `.rex/config.json` → `test`: the command rex runs. */
  testCommand: string | null;
  mcpServers: RepoMcpServer[];
  /**
   * True when the machine-local config file (`.n-dx.local.json`) is in the
   * git index: the repository ships it, so its execution-relevant fields are
   * folded into the ones above and it applies only once trusted.
   */
  localConfigTracked: boolean;
  /** sha256 over the canonical JSON of everything above except `sources`, `detectedLanguage` and `envDeny`. */
  digest: string;
}

/**
 * Project-config fields that decide where an API key is sent or which
 * environment variable is sent as one. A repository that sets them could
 * point the key at its own host, or name `GITHUB_TOKEN` as the Google key, so
 * the project config's values apply only once the user has trusted it; the
 * user's `.n-dx.local.json` always applies. See `credential-routing.ts`.
 */
export const CREDENTIAL_ROUTING_FIELDS: readonly (readonly string[])[] = [
  ["claude", "api_endpoint"],
  ["llm", "claude", "api_endpoint"],
  ["llm", "codex", "api_endpoint"],
  ["llm", "google", "api_endpoint"],
  ["llm", "google", "apiKeyEnv"],
];

function fieldAt(root: Record<string, unknown>, path: readonly string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/**
 * Project-config fields that choose the vendor CLI binary n-dx spawns. A
 * repository that sets one runs its own script with the user's environment
 * the next time `ndx auth` or `ndx work` starts the vendor CLI, so, like
 * {@link CREDENTIAL_ROUTING_FIELDS}, the project config's values apply only
 * once the user has trusted it. `cli_path` is machine-local; `ndx config`
 * writes it to `.n-dx.local.json`, which always applies. `cli.claudePath` is
 * the binary `ndx init` probes and registers MCP servers with; core's
 * discovery reads it from `.n-dx.local.json` only.
 */
export const VENDOR_CLI_PATH_FIELDS: readonly (readonly string[])[] = [
  ["cli", "claudePath"],
  ["claude", "cli_path"],
  ["llm", "claude", "cli_path"],
  ["llm", "codex", "cli_path"],
];

/** The {@link CREDENTIAL_ROUTING_FIELDS} a config object sets, as sorted `path = value` lines. */
export function credentialRoutingIn(config: Record<string, unknown> | null): string[] {
  return fieldsSetIn(config, CREDENTIAL_ROUTING_FIELDS);
}

/** The {@link VENDOR_CLI_PATH_FIELDS} a config object sets, as sorted `path = value` lines. */
export function vendorCliPathsIn(config: Record<string, unknown> | null): string[] {
  return fieldsSetIn(config, VENDOR_CLI_PATH_FIELDS);
}

function fieldsSetIn(config: Record<string, unknown> | null, paths: readonly (readonly string[])[]): string[] {
  if (!config) return [];
  const out: string[] = [];
  for (const path of paths) {
    const value = fieldAt(config, path);
    // Every reader skips an empty string, so it routes nothing.
    if (typeof value === "string" && value) out.push(`${path.join(".")} = ${value}`);
  }
  return out.sort();
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

/** `config[key]` when it is a plain object, else null. */
function sectionOf(config: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  const value = config?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Is the machine-local config file (`.n-dx.local.json`, or the `.ndx/`
 * container's `config.local.json`) in the git index? `ndx init` ignores it,
 * but ignoring does not untrack a committed file, and a repository can commit
 * one on purpose. A tracked file is repository content, not the user's.
 *
 * False when the file is absent (nothing to apply), when git answers "not in
 * the index", and outside any git work tree (no `.git` walking up), so the
 * file keeps applying there as the user's own. When git cannot answer inside a
 * work tree (dubious ownership, git missing, a corrupt index, a timeout) a
 * committed file would be indistinguishable from the user's, so it counts as
 * tracked and waits for trust. Spawns git only when the file exists.
 */
export function isLocalConfigTracked(projectDir: string): boolean {
  const layout = resolveLayout(projectDir);
  if (!existsSync(layout.localConfigFile)) return false;
  return gitTracksPath(layout.root, relOf(layout.root, layout.localConfigFile)) ?? insideGitWorkTree(layout.root);
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
 * container's `config.json`) are deep-merged over `.hench/config.json` the way
 * hench's own loader folds them, because that file is often tracked too. The
 * user's `.n-dx.local.json` is read only when git tracks it
 * ({@link isLocalConfigTracked}): then the repository ships it, and its
 * sections fold in last, as every loader folds the local file. An untracked
 * one is the user's and stays out.
 */
export function collectRepoExecutionConfig(projectDir: string): RepoExecutionConfig {
  const layout = resolveLayout(projectDir);
  const root = layout.root;
  const sources: string[] = [];

  const henchConfigPath = join(layout.henchDir, "config.json");
  const henchConfig = readJson(henchConfigPath);
  if (henchConfig) sources.push(relOf(root, henchConfigPath));

  const projectConfig = readJson(layout.configFile);
  const projectHench = sectionOf(projectConfig, "hench");
  if (projectHench) sources.push(relOf(root, layout.configFile));

  const localConfigTracked = isLocalConfigTracked(projectDir);
  const localConfig = localConfigTracked ? readJson(layout.localConfigFile) : null;
  if (localConfigTracked) sources.push(relOf(root, layout.localConfigFile));

  // Deep, as hench's loader and core's loadAllConfigs fold them: a shallow
  // spread let a project-config `guard` without `env` drop the hench file's
  // `guard.env.deny`, so repository commands kept a variable the user denied.
  const merged = deepMerge(deepMerge(henchConfig ?? {}, projectHench ?? {}), sectionOf(localConfig, "hench") ?? {});
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

  const rawEnv = rawGuard && rawGuard.env && typeof rawGuard.env === "object" && !Array.isArray(rawGuard.env)
    ? (rawGuard.env as Record<string, unknown>)
    : null;
  const envAllow = rawEnv ? stringArray(rawEnv.allow) ?? [] : [];
  const envDeny = rawEnv ? stringArray(rawEnv.deny) ?? [] : [];

  const rexConfigPath = join(layout.rexDir, "config.json");
  const rexConfig = readJson(rexConfigPath);
  if (rexConfig) sources.push(relOf(root, rexConfigPath));
  // Rex folds the project config's `rex` section over `.rex/config.json` when
  // it loads its config, so a `rex.test` there is the command that runs. Left
  // out, a repository could swap the command after the user accepted the one
  // they reviewed without moving the digest (#686).
  const projectTest = optionalString(sectionOf(localConfig, "rex")?.test)
    ?? optionalString(sectionOf(projectConfig, "rex")?.test);
  // A field the tracked local file sets wins over the project config's, as
  // in every loader's merge, so the effective value is what is listed.
  const effective = localConfig ? deepMerge(projectConfig ?? {}, localConfig) : projectConfig;
  const credentialRouting = credentialRoutingIn(effective);
  // Hench falls back to `claudePath` when no `cli_path` is set, so it chooses
  // the Claude binary too. The bare PATH name chooses nothing, and leaving it
  // out keeps the digest of every checkout `ndx init` wrote it into.
  const henchClaudePath = optionalString(merged.claudePath);
  const vendorCliPaths = [
    ...vendorCliPathsIn(effective),
    ...(henchClaudePath && henchClaudePath !== "claude" ? [`hench.claudePath = ${henchClaudePath}`] : []),
  ].sort();
  const projectSetsGated = optionalString(sectionOf(projectConfig, "rex")?.test)
    || credentialRoutingIn(projectConfig).length
    || vendorCliPathsIn(projectConfig).length;
  if (projectSetsGated && !projectHench) {
    sources.push(relOf(root, layout.configFile));
  }

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
    // Present only when the repository ships entries. An empty key would
    // move every existing digest on upgrade, and a repository trusted before
    // this field existed would read as `changed` with nothing having changed.
    ...(envAllow.length ? { envAllow: [...envAllow].sort() } : {}),
    // Present only when set, for the same reason.
    ...(credentialRouting.length ? { credentialRouting } : {}),
    ...(vendorCliPaths.length ? { vendorCliPaths } : {}),
    permissionMode: optionalString(merged.permissionMode),
    provider: optionalString(merged.provider),
    testCommand: projectTest ?? optionalString(rexConfig?.test),
    mcpServers,
    // Present only when tracked, so no untracked checkout's digest moves.
    ...(localConfigTracked ? { localConfigTracked: true } : {}),
  };

  return {
    sources,
    ...body,
    detectedLanguage: detectRepoLanguage(root),
    guard,
    envAllow: [...envAllow].sort(),
    envDeny: [...envDeny].sort(),
    credentialRouting,
    vendorCliPaths,
    localConfigTracked,
    digest: createHash("sha256").update(toCanonicalJSON(body)).digest("hex"),
  };
}

// ── Assessment ──────────────────────────────────────────────────────────────

export type RepoTrustFindingCode =
  | "language-mismatch"
  | "commands-added"
  | "blocked-paths-removed"
  | "dependency-paths-removed"
  | "git-subcommands-added"
  | "env-allow-added"
  | "credential-routing"
  | "vendor-cli-path"
  | "permission-bypass"
  | "test-command"
  | "mcp-servers"
  | "secret-paths-unblocked"
  | "local-config-tracked";

export interface RepoTrustFinding {
  code: RepoTrustFindingCode;
  /** `warning` widens what may execute and makes the repository deviate; `info` is shown but does not. */
  severity: "warning" | "info";
  message: string;
  /** The concrete values behind the message, for a UI that wants to list them. */
  values: string[];
}

const SHELL_RISK = /[;&|`$]|\b(curl|wget|sh -c|bash -c|powershell|iex\b|Invoke-Expression)\b/i;

/**
 * C0 and C1 controls, DEL, and the Unicode bidirectional overrides and
 * isolates. A terminal acts on the first group (ESC starts a CSI/OSC sequence
 * that can erase or rewrite a line; CR returns to the start of one) and
 * reorders text around the second, so either can make a line show something
 * other than what it holds.
 */
const DISPLAY_UNSAFE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/**
 * Render a repository-sourced string for display: every character in
 * {@link DISPLAY_UNSAFE} becomes a visible `\xNN` / `\uNNNN` escape, so a trust
 * review shows exactly what the user is accepting. Display only — the digest
 * and the stored record keep the raw value. Idempotent.
 */
export function escapeTerminalControls(text: string): string {
  return text.replace(DISPLAY_UNSAFE, (ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0xff
      ? `\\x${code.toString(16).padStart(2, "0")}`
      : `\\u${code.toString(16).padStart(4, "0")}`;
  });
}

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

/** True when `blocked` lists `pattern` itself or its any-depth `**\/` form. */
function blocksPattern(blocked: string[], pattern: string): boolean {
  return blocked.some((p) => {
    const n = p.replace(/\\/g, "/");
    return n === pattern || n === `**/${pattern}`;
  });
}

/**
 * List how the repository's configuration is wider than the baseline for its
 * detected language. Narrower is not reported. A missing guard means the
 * repository left hench's defaults in force, which is the baseline by
 * definition.
 *
 * A declared language naming another baseline is a warning: the checkout
 * asks for a toolchain it does not have, so the user is asked. A declared
 * value naming no baseline (`auto`, an unsupported language) selects
 * nothing and is not reported.
 */
export function assessRepoExecutionConfig(config: RepoExecutionConfig): RepoTrustFinding[] {
  const findings = assessRawFindings(config);
  // Messages embed repository values and are printed by every trust surface;
  // `values` stay raw for a UI that renders them as data.
  return findings.map((f) => ({ ...f, message: escapeTerminalControls(f.message) }));
}

function assessRawFindings(config: RepoExecutionConfig): RepoTrustFinding[] {
  const detected = config.detectedLanguage;
  const baseline = guardBaselineForLanguage(detected);
  const findings: RepoTrustFinding[] = [];

  const declared = declaredLanguageFamily(config.language);
  if (config.language && declared && declared !== detected) {
    findings.push({
      code: "language-mismatch",
      severity: "warning",
      message: `Declares language ${config.language}, but the checkout looks like ${languageLabel(detected)}; the ${languageLabel(detected)} baseline applies`,
      values: [config.language, detected],
    });
  }

  if (config.guard) {
    const added = config.guard.allowedCommands.filter((c) => !baseline.allowedCommands.includes(c));
    if (added.length) {
      findings.push({
        code: "commands-added",
        severity: "warning",
        message: `Allows the agent to run commands outside the ${languageLabel(detected)} baseline: ${added.join(", ")}`,
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

    // Only the detected language's directories: they are what `ndx init` has
    // always written for it, so an initialized guard raises nothing. A guard
    // that drops one would otherwise read as baseline and never be clamped.
    const depsRemoved = LANGUAGE_BASELINES[detected].extraBlocked.filter((p) => !blocksPattern(config.guard!.blockedPaths, p));
    if (depsRemoved.length) {
      findings.push({
        code: "dependency-paths-removed",
        severity: "warning",
        message: `Lets the agent write to the ${languageLabel(detected)} dependency directories it is normally kept out of: ${depsRemoved.join(", ")}`,
        values: depsRemoved,
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

    if (config.envAllow.length) {
      findings.push({
        code: "env-allow-added",
        severity: "warning",
        message: `Passes credential-shaped environment variables through to the agent's processes: ${config.envAllow.join(", ")}`,
        values: [...config.envAllow],
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

  if (config.credentialRouting.length) {
    findings.push({
      code: "credential-routing",
      severity: "warning",
      message: `Chooses where API keys are sent, or which variable is sent as one: ${config.credentialRouting.join(", ")}`,
      values: [...config.credentialRouting],
    });
  }

  if (config.vendorCliPaths.length) {
    findings.push({
      code: "vendor-cli-path",
      severity: "warning",
      message: `Chooses the vendor CLI binary n-dx runs: ${config.vendorCliPaths.join(", ")}`,
      values: [...config.vendorCliPaths],
    });
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

  // A warning whatever the file holds: every reader would otherwise apply it
  // as the user's own, so it is repository config the user has to accept.
  if (config.localConfigTracked) {
    // `.n-dx.local.json`, or `.ndx/config.local.json` on the container layout.
    // `collectRepoExecutionConfig` always lists it; the fallback names the legacy file.
    const legacy = resolveLayout(".", { mode: "legacy" });
    const file = config.sources.find((s) => s.endsWith("local.json"))
      ?? relativeToRoot(legacy, legacy.localConfigFile);
    findings.push({
      code: "local-config-tracked",
      severity: "warning",
      message: `Commits ${file}, the machine-local config n-dx otherwise applies as yours; its settings apply only once trusted`,
      values: [file],
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
  /**
   * PRD nodes (directories holding `index.md`) across every tree root. `epics`
   * counts the top-level ones: v1 epics, v2 capabilities and changes.
   */
  prd: { items: number; epics: number } | null;
  analysis: { analyzedAt: string | null; version: string | null } | null;
  henchRuns: number | null;
}

/** The folder trees under the rex dir: v1 `prd_tree/`, v2 `product/` and `changes/`. */
const PRD_TREE_ROOTS = ["prd_tree", "product", "changes"] as const;

/** True when `path` resolves to a location inside `realRoot` (itself resolved). */
function resolvesInside(realRoot: string, path: string): boolean {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return false;
  }
  return real === realRoot || real.startsWith(realRoot + sep);
}

/**
 * Count PRD nodes under every tree root.
 *
 * This runs before the user has accepted the repository, so the checkout picks
 * the directory structure: a tree root that resolves outside the repository is
 * ignored, and the walk never descends through a link (Dirent types are lstat
 * types), which rules out both escaping the repository and looping.
 */
function countPrdTrees(projectDir: string, rexDir: string): { items: number; epics: number } | null {
  let realRoot: string;
  try {
    realRoot = realpathSync(projectDir);
  } catch {
    return null;
  }
  let found = false;
  let items = 0;
  let epics = 0;
  const walk = (dir: string, depth: number): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (existsSync(join(full, "index.md"))) {
        items += 1;
        if (depth === 0) epics += 1;
      }
      walk(full, depth + 1);
    }
  };
  for (const root of PRD_TREE_ROOTS) {
    const treeDir = join(rexDir, root);
    if (!resolvesInside(realRoot, treeDir)) continue;
    found = true;
    walk(treeDir, 0);
  }
  return found ? { items, epics } : null;
}

export function collectRepoInventory(projectDir: string): RepoInventory {
  const layout = resolveLayout(projectDir);
  const prd = countPrdTrees(projectDir, layout.rexDir);
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

/** The state an evaluation reports; see {@link evaluateRepoTrust}. */
export function repoTrustState(
  config: RepoExecutionConfig,
  findings: readonly RepoTrustFinding[],
  record: RepoTrustRecord | null,
): RepoTrustState {
  if (!findings.some((f) => f.severity === "warning")) return "baseline";
  if (record && record.digest === config.digest) return "trusted";
  return record ? "changed" : "untrusted";
}

/** Whether a caller should clamp and warn for this state. */
export function isRestrictedState(state: RepoTrustState): boolean {
  return state === "untrusted" || state === "changed";
}

/**
 * Whether the machine-local config may be applied as the user's own, by a
 * reader that otherwise applies it whatever the trust state. True when the
 * file is not tracked by git ({@link isLocalConfigTracked}); a tracked one is
 * repository config and applies only while the checkout is not restricted.
 * A tracked file always raises `local-config-tracked`, so that means trusted.
 */
export function userLocalConfigApplies(projectDir: string, options: RepoTrustStoreOptions = {}): boolean {
  if (!isLocalConfigTracked(projectDir)) return true;
  const config = collectRepoExecutionConfig(projectDir);
  return !isRestrictedState(
    repoTrustState(config, assessRepoExecutionConfig(config), readRepoTrustRecord(projectDir, options)),
  );
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
  const state = repoTrustState(config, findings, record);

  return {
    state,
    restricted: isRestrictedState(state),
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
  // A plain test command leaves the checkout baseline, but verify_criteria and
  // rex verify still run it only once this exact config is accepted (#686
  // finding 2), so the baseline report must say which side of that it is on.
  const pendingTestCommand = ev.state === "baseline" && ev.config.testCommand != null
    && ev.record?.digest !== ev.config.digest;

  switch (ev.state) {
    case "baseline":
      if (!ev.config.testCommand) {
        lines.push("Repository execution config: matches the defaults (nothing to trust).");
      } else if (pendingTestCommand) {
        lines.push("Repository execution config: matches the defaults, but its test command is not accepted.");
      } else {
        lines.push(`Repository execution config: matches the defaults; test command accepted by you on ${ev.record?.trustedAt ?? "?"}.`);
      }
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
    lines.push("  bypassPermissions is lowered to acceptEdits, verify_criteria does not run the test command,");
    lines.push("  and the project config's API endpoints and API key variables are ignored.");
    const tracked = ev.findings.find((f) => f.code === "local-config-tracked");
    if (tracked) {
      lines.push(`  The committed ${tracked.values[0]} is ignored too, as repository config. To keep settings of your own,`);
      lines.push("  untrack it (git rm --cached) and keep it ignored, or accept the configuration.");
    } else if (ev.findings.some((f) => f.code === "env-allow-added")) {
      lines.push("  The repository's guard.env.allow is ignored too. If your own tests need one of those variables,");
      lines.push(`  add it to hench.guard.env.allow in .n-dx.local.json, or accept the configuration.`);
    }
    lines.push(`  To accept this configuration: ${accept}`);
  } else if (pendingTestCommand) {
    lines.push(`  verify_criteria and rex verify run the test command only once accepted: ${accept}`);
  }
  // Finding messages are escaped already; this also covers the source paths
  // and the analysis timestamp, which come from the checkout too.
  return lines.map(escapeTerminalControls);
}
