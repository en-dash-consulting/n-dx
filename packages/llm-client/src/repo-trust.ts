/**
 * Repository trust: what a checkout brought with it, and whether this user
 * has agreed to run under it.
 *
 * Several files that n-dx reads to decide *what it may execute* live inside
 * the repository and are usually tracked by git: the hench guard in
 * `.hench/config.json` (command allowlist, blocked paths, git subcommands,
 * permission mode, the child-environment allowlist) and its run posture
 * (`autonomous`, `autoCommit`, `skipFullTestGate`, `apiKeyEnv`,
 * `claudePath`); the `llm.*` binaries and endpoints and `web.auth` in the
 * project config; the test command in `.rex/config.json`; the MCP servers in
 * `.mcp.json`; the assistants' own project files (`.claude/settings.json`,
 * `.claude/hooks/**`, `.codex/config.toml`); and every `run` block saved on
 * a PRD item. A clone, a fork, or a checked-out pull request can therefore
 * ship a *looser* policy than the one the user's own `ndx init` would have
 * written, and nothing used to say so.
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
 *   for a different digest). {@link isRepoRestricted} is the same decision
 *   for readers that run on every config load.
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
 * every reader that applies the local file regardless of trust checks first:
 * the env-allow gates (hench's `applyRepoTrust`, `repoCommandEnv`, core's
 * `applyRepoTrustToEnvPolicy`) read `localConfigTracked` from the
 * {@link RepoExecutionConfig} they already hold, and the LLM config loaders
 * pass the file through `trustedLocalConfig` (credential-routing), which asks
 * {@link isLocalConfigTracked}. Core, which spawns rather than imports, asks
 * the same check for `cli.claudePath` through `hench trust status`
 * (`packages/core/claude-integration.js`). "Tracked" covers a case variant
 * of the file name and a file reached through a symlink: git matches neither
 * under the path n-dx opens. A tracked local file is repository
 * config: it is collected here, raises `local-config-tracked`, and applies
 * only once the checkout is trusted. Outside a git work tree nothing is
 * tracked, so the local file is the user's, as before; inside one, a git that
 * cannot answer counts the file as tracked, and the finding says git could not
 * confirm it is untracked ({@link RepoExecutionConfig.localConfigUnanswered}).
 * Readers also ignore tracked local hosts, run posture, assistant grants and saved run settings until accepted.
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
  lstatSync,
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
import { gitlinkAt, gitTracksPath, insideGitWorkTree } from "./exec.js";
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

/** The `.ndx/` layout's paths, resolved the same way, for {@link NDX_CONFIG_BLOCKED_PATHS}. */
const NDX_LAYOUT = resolveLayout(".", { mode: "ndx" });

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
  // Machine-local n-dx overrides hold API keys by design. The `.ndx/` layout's
  // copy sits inside the container, which CORE_BLOCKED already covers.
  relativeToRoot(LEGACY_LAYOUT, LEGACY_LAYOUT.localConfigFile),
  `**/${relativeToRoot(LEGACY_LAYOUT, LEGACY_LAYOUT.localConfigFile)}`,
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

/** The project MCP registration file `ndx init` writes and the trust review reads. */
const PROJECT_MCP_CONFIG = ".mcp.json";

/**
 * n-dx's own config files and the assistant config it hands the vendor CLIs.
 * Blocked by every baseline, and enforced by hench's guard whatever the
 * configured guard says (#686).
 *
 * The local config file is read as the user's own and applies with no trust
 * review, so an agent steered into writing it would hand itself a guard that
 * passes every credential through, a `cli_path` or an endpoint. The tracked
 * config, `.mcp.json` and the `.claude/` and `.codex/` directories configure
 * what the next run executes in the same way.
 *
 * Both layouts' names, from the layout resolver: hench enforces this list
 * apart from the baseline, so the `.ndx/` container's own block in
 * {@link CORE_BLOCKED} does not cover a guard that dropped it.
 */
export const NDX_CONFIG_BLOCKED_PATHS: readonly string[] = [
  ...[LEGACY_LAYOUT, NDX_LAYOUT].flatMap((layout) => [
    relativeToRoot(layout, layout.configFile),
    relativeToRoot(layout, layout.localConfigFile),
  ]),
  PROJECT_MCP_CONFIG,
  ".claude/**",
  ".codex/**",
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
    blockedPaths: [...new Set([...CORE_BLOCKED, ...NDX_CONFIG_BLOCKED_PATHS, ...DEPENDENCY_BLOCKED, ...SECRET_PATH_PATTERNS])],
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

/**
 * Hench settings that decide how far an unattended run goes on its own and
 * which binary and credential it uses. Read from `.hench/config.json` with
 * the project config's `hench` overrides folded over it, like the guard.
 */
export interface RepoRunPosture {
  /** `hench.autonomous`: runs never wait for a confirmation. */
  autonomous: boolean | null;
  /** `hench.autoCommit`: the agent's work is committed without review. */
  autoCommit: boolean | null;
  /** `hench.skipFullTestGate`: a task completes without the project's tests. */
  skipFullTestGate: boolean | null;
  /** `hench.apiKeyEnv`: the environment variable sent as the API key. */
  apiKeyEnv: string | null;
  /** `hench.claudePath`: the binary the Claude CLI provider executes. */
  claudePath: string | null;
}

/** `llm.*` keys in the project config that choose a binary or a network destination. */
export interface RepoLlmEndpoints {
  /** `llm.<vendor>.cli_path`, plus the legacy top-level `claude.cli_path`, keyed by vendor. */
  cliPaths: Record<string, string>;
  /** `llm.<vendor>.api_endpoint`, keyed by vendor. */
  apiEndpoints: Record<string, string>;
  /** `llm.local.host`. */
  localHost: string | null;
  /** `llm.local.port`. */
  localPort: number | null;
  /** An explicitly configured local verifier destination. */
  localVerifier?: { host: string | null; port: number | null };
  /** `llm.google.apiKeyEnv`. */
  googleApiKeyEnv: string | null;
}

/** One assistant configuration file the checkout ships, by content hash. */
export interface RepoAssistantFile {
  /** Relative to the project root, forward slashes. */
  path: string;
  sha256: string;
}

/** What `.claude/settings.json` grants the assistant without asking. */
export interface RepoClaudeSettings {
  /** `permissions.allow` entries. */
  allow: string[];
  /** `permissions.defaultMode`. */
  defaultMode: string | null;
  /** Whether a `hooks` block is present. */
  hooks: boolean;
  /** Variable names set by the `env` block. */
  env: string[];
}

/** A `run` block saved on a PRD item, as its front matter spells it. */
export interface RepoPrdRunBlock {
  /** The item's `index.md`, relative to the project root. */
  path: string;
  /** The parsed block when it is JSON, else the raw text after `run:`. */
  run: unknown;
}

/** The hench config keys whose value hench's test gate runs as a shell command. */
const GATE_TEST_COMMAND_KEYS = ["testGate.command", "testGate.rerunCommand", "fullTestCommand"] as const;

/** A shell command hench's test gate runs, by the `hench.*` key that sets it. */
export interface RepoGateTestCommand {
  key: (typeof GATE_TEST_COMMAND_KEYS)[number];
  command: string;
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
   * The project config's {@link CREDENTIAL_ROUTING_FIELDS} that are set, and a
   * hench `apiKeyEnv` other than {@link DEFAULT_HENCH_API_KEY_ENV}, as
   * `path = value`, sorted: where an API key is sent, and which variable is
   * sent as one.
   */
  credentialRouting: string[];
  /**
   * The project config's {@link VENDOR_CLI_PATH_FIELDS} that are set, and a
   * hench `claudePath` other than the bare `claude`, as `path = value`,
   * sorted: the vendor CLI, graview binary or graview face n-dx runs.
   */
  vendorCliPaths: string[];
  permissionMode: string | null;
  provider: string | null;
  posture: RepoRunPosture;
  llm: RepoLlmEndpoints;
  /** `web.auth === false` in the project config: the dashboard starts without its token. */
  webAuthDisabled: boolean;
  /** `.claude/settings.json`, `.claude/hooks/**` and `.codex/config.toml`, each by content hash. */
  assistantFiles: RepoAssistantFile[];
  /** The grants in `.claude/settings.json`, when the file parses. */
  claudeSettings: RepoClaudeSettings | null;
  /** Every `run` block saved on a PRD item, in path order. */
  prdRunBlocks: RepoPrdRunBlock[];
  /** The project config's `rex.test`, else `.rex/config.json` → `test`: the command rex runs. */
  testCommand: string | null;
  /** The commands hench's test gate runs, as the folded hench config sets them, in gate order. */
  gateTestCommands: RepoGateTestCommand[];
  mcpServers: RepoMcpServer[];
  /**
   * True when the machine-local config file (`.n-dx.local.json`) is in the
   * git index: the repository ships it, so its execution-relevant fields are
   * folded into the ones above and it applies only once trusted.
   */
  localConfigTracked: boolean;
  /**
   * Set when {@link localConfigTracked} holds only because git could not
   * answer inside a work tree: git's reason (its first stderr line). The file
   * may well be the user's, so the review must not call it committed. Not in
   * the digest.
   */
  localConfigUnanswered: string | null;
  /**
   * The index entries git matched for the local config file, as git spells
   * them: a case variant as committed, or a committed symlinked directory and
   * its target, rather than the path n-dx opens. Empty unless git said
   * tracked. Not in the digest.
   */
  localConfigTrackedPaths: string[];
  /**
   * Set when {@link localConfigTracked} holds because the file lies inside a
   * submodule or another nested work tree: that directory, relative to the
   * root. git rm --cached cannot untrack such a file. Not in the digest.
   */
  localConfigNestedIn: string | null;
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

/**
 * The variable hench's API loop sends as the Anthropic key when nothing
 * chooses another. A different hench `apiKeyEnv` from the repository is
 * credential routing: hench applies it only once the repository is trusted.
 * Mirrors hench's `DEFAULT_HENCH_CONFIG().apiKeyEnv`; hench's `trust.test.ts`
 * fails if the two drift (a default config would stop reading as baseline).
 */
export const DEFAULT_HENCH_API_KEY_ENV = "ANTHROPIC_API_KEY";

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
 * discovery reads it from `.n-dx.local.json` only. `graview.bin` is the
 * binary `ndx graview <sub>` spawns; `@n-dx/graview` reads its config through
 * `trustedProjectConfig` and `trustedLocalConfig` (credential-routing).
 * `graview.app` once named the product face, which is now an extension that
 * core finds and the user approves; the field is retired and runs nothing,
 * but stays a finding so a checkout that still sets it is not trusted
 * silently.
 */
export const VENDOR_CLI_PATH_FIELDS: readonly (readonly string[])[] = [
  ["cli", "claudePath"],
  ["claude", "cli_path"],
  ["graview", "app"],
  ["graview", "bin"],
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

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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
  return localConfigTrackState(projectDir).tracked;
}

/**
 * {@link isLocalConfigTracked}, plus git's reason when the answer is "tracked"
 * only because git could not say (`unanswered`), so the review can tell the
 * user to fix git rather than untrack a file the repository may not commit,
 * and the index entries git matched (`paths`), which are what `git rm --cached`
 * has to name: a case variant as committed, a symlinked directory and its target.
 */
function localConfigTrackState(
  projectDir: string,
): { tracked: boolean; unanswered: string | null; paths: string[]; nestedIn: string | null } {
  const untracked = { tracked: false, unanswered: null, paths: [], nestedIn: null };
  const layout = resolveLayout(projectDir);
  if (!existsSync(layout.localConfigFile)) return untracked;
  const shipped = shippedPathsOf(layout.root, layout.localConfigFile);
  const answers = shipped.map((rel) => gitTracksPath(layout.root, rel, { ignoreCase: true }));
  const paths = [...new Set(answers.flatMap((a) => (a.state === "tracked" ? a.paths : [])))];
  if (paths.length) return { tracked: true, unanswered: null, paths, nestedIn: null };
  const nested = nestedRepositoryAbove(layout.root, shipped);
  if (nested.dir) return { tracked: true, unanswered: null, paths: [], nestedIn: nested.dir };
  const failed = answers.find((a) => a.state === "unanswered")?.reason ?? nested.unanswered;
  if (!failed) return untracked;
  return insideGitWorkTree(layout.root)
    ? { tracked: true, unanswered: failed, paths: [], nestedIn: null }
    : untracked;
}

/**
 * The first directory, strictly between `root` and one of `paths`, that is
 * another repository's: the top of a nested work tree (a `.git` entry, which
 * every checked-out submodule has) or a gitlink in the index. git lists
 * nothing inside either, so a file the submodule commits reads as untracked
 * to {@link gitTracksPath}, yet `git clone --recursive` delivers it.
 * The walk stops at a symlink: what lies beyond it is the real path's walk,
 * so a user's own `.ndx` linked into a repository of their dotfiles stays theirs.
 * `unanswered` carries git's reason when a gitlink query failed.
 */
function nestedRepositoryAbove(root: string, paths: string[]): { dir: string | null; unanswered: string | null } {
  let unanswered: string | null = null;
  const seen = new Set<string>();
  for (const rel of paths) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (isSymlink(join(root, dir))) break;
      if (seen.has(dir)) continue;
      seen.add(dir);
      if (existsSync(join(root, dir, ".git"))) return { dir, unanswered: null };
      const answer = gitlinkAt(root, dir, { ignoreCase: true });
      if (answer.state === "unanswered") unanswered ??= answer.reason;
      else if (answer.gitlink) return { dir, unanswered: null };
    }
  }
  return { dir: null, unanswered };
}

/**
 * Every path, relative to `root`, through which the repository could ship
 * `file`; the file is the repository's when git tracks any of them. git lists
 * nothing beyond a symlink, so asking only about the path n-dx opens misses a
 * file reached through a committed symlink (`.ndx -> cfg`). Hence also each
 * symlinked directory on the way, and the file's real path when it lies in the
 * checkout. A real path outside the checkout is the user's, unless a committed
 * symlink led there.
 */
function shippedPathsOf(root: string, file: string): string[] {
  const rel = relOf(root, file);
  const paths = new Set([rel]);
  const parts = rel.split("/");
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join("/");
    if (isSymlink(join(root, dir))) paths.add(dir);
  }
  const real = realPathIn(root, file);
  if (real) paths.add(real);
  return [...paths];
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** `file`'s on-disk path relative to `root`'s, or null when it lies outside (or cannot be resolved). */
function realPathIn(root: string, file: string): string | null {
  try {
    const realRoot = realpathSync.native(root);
    const realFile = realpathSync.native(file);
    return realFile.startsWith(realRoot + sep) ? relOf(realRoot, realFile) : null;
  } catch {
    return null;
  }
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

function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Every regular file under `dir`, recursively, sorted. Empty when `dir` is absent. */
function listFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      const full = join(current, name);
      let isDir = false;
      let isFile = false;
      try {
        const st = lstatSync(full);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
      if (isDir) walk(full);
      else if (isFile) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** The content hash of a file, or null when it cannot be read. */
function hashFile(path: string): string | null {
  try {
    return sha256(readFileSync(path));
  } catch {
    return null;
  }
}

/** The grants `.claude/settings.json` makes, or null when it is absent or not an object. */
function readClaudeSettings(path: string): RepoClaudeSettings | null {
  const settings = readJson(path);
  if (!settings) return null;
  const permissions = asRecord(settings.permissions);
  const env = asRecord(settings.env);
  return {
    allow: permissions ? (stringArray(permissions.allow) ?? []) : [],
    defaultMode: permissions ? optionalString(permissions.defaultMode) : null,
    hooks: asRecord(settings.hooks) !== null && Object.keys(asRecord(settings.hooks)!).length > 0,
    env: env ? Object.keys(env).sort() : [],
  };
}

/**
 * The `run:` entry of one item's front matter, or undefined when the file
 * has none. rex writes the block as inline JSON (`run: {"tier":"light"}`);
 * a block spelled any other way is kept as raw text so a hand edit still
 * moves the digest. Only the front matter is scanned — a `run:` in the body
 * is prose.
 */
export function scanFrontMatterRunBlock(content: string): unknown {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return undefined;
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === "---") break;
    const match = /^run:(.*)$/.exec(lines[i]);
    if (!match) continue;
    const inline = match[1].trim();
    if (inline.length > 0) {
      try {
        return JSON.parse(inline);
      } catch {
        return inline;
      }
    }
    // A block value: the indented lines that follow.
    const block: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "---" || !/^\s/.test(lines[j])) break;
      block.push(lines[j]);
    }
    return block.join("\n");
  }
  return undefined;
}

/** Every `run` block saved on an item under the PRD directories, in path order. */
function scanPrdRunBlocks(root: string, rexDir: string): RepoPrdRunBlock[] {
  const blocks: RepoPrdRunBlock[] = [];
  for (const sub of ["changes", "prd_tree", "product"]) {
    for (const file of listFilesUnder(join(rexDir, sub))) {
      if (!file.endsWith(`${sep}index.md`)) continue;
      let content: string;
      try {
        content = readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      const run = scanFrontMatterRunBlock(content);
      if (run !== undefined) blocks.push({ path: relOf(root, file), run });
    }
  }
  return blocks.sort((a, b) => a.path.localeCompare(b.path));
}

/** Vendor names whose `llm.<vendor>` block the digest reads. */
const LLM_VENDOR_KEYS = ["claude", "codex", "google", "local"] as const;

// ── Override folding ────────────────────────────────────────────────────────
//
// hench deep-merges each project override layer over `.hench/config.json`,
// validates the result against its schema, and reverts every top-level field
// that fails to the layer below. The review must read the same way, or an
// override of the wrong type reads as an empty allowlist here while hench
// runs the wide one beneath it. These checks mirror hench's schema for the
// top-level fields the review reads (the collector's types refuse a read of
// any other field), and hench's `trust.test.ts` holds each to that schema.

type FieldCheck = (value: unknown) => boolean;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === "string";
const positive: FieldCheck = (v) => isNumber(v) && v > 0;
const nonNegative: FieldCheck = (v) => isNumber(v) && v >= 0;
// zod's int() also refuses integers past Number.MAX_SAFE_INTEGER, which
// Number.isInteger accepts.
const nonNegativeInt: FieldCheck = (v) => nonNegative(v) && Number.isSafeInteger(v);
const percent: FieldCheck = (v) => nonNegative(v) && (v as number) <= 100;
const strings: FieldCheck = (v) => stringArray(v) !== null;
const optional = (check: FieldCheck): FieldCheck => (v) => v === undefined || check(v);
const oneOf = (...values: string[]): FieldCheck => (v) => typeof v === "string" && values.includes(v);
/** An object whose listed fields pass; unlisted keys are ignored, as hench's (non-strict) schema ignores them. */
const shape = (fields: Record<string, FieldCheck>): FieldCheck =>
  (v) => isRecord(v) && Object.entries(fields).every(([key, check]) => check(v[key]));

// Fields hench requires are checked only when present. JSON cannot delete a
// key, so one is missing after the merge only when `.hench/config.json` lacks
// it, and hench refuses or salvages that file before any override applies.
const HENCH_FIELD_CHECKS = {
  autonomous: optional((v) => typeof v === "boolean"),
  autoCommit: optional((v) => typeof v === "boolean"),
  guard: shape({
    blockedPaths: optional(strings),
    allowedCommands: optional(strings),
    commandTimeout: optional(positive),
    maxFileSize: optional(positive),
    spawnTimeout: optional(nonNegative),
    sessionTimeout: optional(nonNegativeInt),
    maxConcurrentProcesses: optional((v) => positive(v) && Number.isSafeInteger(v)),
    allowedGitSubcommands: optional(strings),
    policy: optional(shape({
      maxCommandsPerMinute: optional(nonNegativeInt),
      maxWritesPerMinute: optional(nonNegativeInt),
      maxTotalBytesWritten: optional(nonNegativeInt),
      maxTotalCommands: optional(nonNegativeInt),
    })),
    memoryThrottle: optional(shape({
      enabled: optional((v) => typeof v === "boolean"),
      delayThreshold: optional(percent),
      rejectThreshold: optional(percent),
      baseDelayMs: optional(positive),
      maxDelayMs: optional(positive),
      maxRetries: optional(nonNegativeInt),
    })),
    memoryMonitor: optional(shape({
      enabled: optional((v) => typeof v === "boolean"),
      spawnThreshold: optional(percent),
    })),
    env: optional(shape({ deny: optional(strings), allow: optional(strings) })),
  }),
  apiKeyEnv: optional((v) => typeof v === "string"),
  // hench falls back to it when no cli_path is set: an invalid override must
  // not hide the binary the layer below names.
  claudePath: optional((v) => typeof v === "string"),
  permissionMode: optional(oneOf("default", "acceptEdits", "bypassPermissions", "plan")),
  language: optional(oneOf("typescript", "javascript", "go", "swift")),
  provider: optional(oneOf("cli", "api")),
  fullTestCommand: optional(isString),
  testGate: optional(shape({ command: optional(isString), rerunCommand: optional(isString) })),
} satisfies Record<string, FieldCheck>;

/**
 * The checks the review folds hench override layers with, one per top-level
 * hench field it reads. Exported so hench's tests can hold each to its schema.
 */
export const HENCH_OVERRIDE_FIELD_CHECKS: Readonly<Record<string, FieldCheck>> = HENCH_FIELD_CHECKS;

/** The folded hench section, readable only through fields that have a check. */
type ReviewedHench = { readonly [K in keyof typeof HENCH_FIELD_CHECKS]?: unknown };

/**
 * Fold one override layer over `lower` as hench's loader does: deep-merge,
 * then revert each field the review reads that came out invalid to its value
 * in `lower`.
 */
function foldHenchOverride(lower: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged = deepMerge(lower, override);
  for (const [key, valid] of Object.entries(HENCH_FIELD_CHECKS)) {
    if (valid(merged[key])) continue;
    if (key in lower) merged[key] = lower[key];
    else delete merged[key];
  }
  return merged;
}

/**
 * Read the repository's execution-relevant configuration.
 *
 * Hench overrides in the project config file (`.n-dx.json`, or the `.ndx/`
 * container's `config.json`) are folded over `.hench/config.json` the way
 * hench's own loader folds them, invalid fields reverting to the lower layer
 * (see {@link foldHenchOverride}), because that file is often tracked too. The
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

  const {
    tracked: localConfigTracked,
    unanswered: localConfigUnanswered,
    paths: localConfigTrackedPaths,
    nestedIn: localConfigNestedIn,
  } = localConfigTrackState(projectDir);
  const localConfig = localConfigTracked ? readJson(layout.localConfigFile) : null;
  if (localConfigTracked) sources.push(relOf(root, layout.localConfigFile));
  const effective = localConfig ? deepMerge(projectConfig ?? {}, localConfig) : projectConfig;

  // Layer by layer, as hench's loader folds them: deep (a shallow spread let a
  // project-config `guard` without `env` drop the hench file's
  // `guard.env.deny`), and an invalid field reverts to the layer beneath it.
  const merged: ReviewedHench = foldHenchOverride(
    foldHenchOverride(henchConfig ?? {}, projectHench ?? {}),
    sectionOf(localConfig, "hench") ?? {},
  );
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

  // hench's gate runs `testGate.command`, else `fullTestCommand`, and
  // `testGate.rerunCommand` after an unattended failure — each read from the
  // folded config, so a repository that sets one is running a shell command
  // exactly as it does with `rex.test`.
  const testGate = isRecord(merged.testGate) ? merged.testGate : {};
  const gateValues: Record<RepoGateTestCommand["key"], unknown> = {
    "testGate.command": testGate.command,
    "testGate.rerunCommand": testGate.rerunCommand,
    fullTestCommand: merged.fullTestCommand,
  };
  const gateTestCommands: RepoGateTestCommand[] = GATE_TEST_COMMAND_KEYS.flatMap((key) => {
    const command = optionalString(gateValues[key]);
    return command ? [{ key, command }] : [];
  });

  // How far a run goes on its own, and which binary and credential it uses.
  const posture: RepoRunPosture = {
    autonomous: optionalBoolean(merged.autonomous),
    autoCommit: optionalBoolean(merged.autoCommit),
    skipFullTestGate: optionalBoolean(asRecord(merged)?.skipFullTestGate),
    apiKeyEnv: optionalString(merged.apiKeyEnv),
    claudePath: optionalString(merged.claudePath),
  };

  // `llm.*` in the project config: binaries and network destinations. The
  // legacy top-level `claude` block still names a Claude binary and endpoint.
  const projectLlm = effective ? asRecord(effective.llm) : null;
  const legacyClaude = effective ? asRecord(effective.claude) : null;
  const llm: RepoLlmEndpoints = { cliPaths: {}, apiEndpoints: {}, localHost: null, localPort: null, googleApiKeyEnv: null };
  for (const vendor of LLM_VENDOR_KEYS) {
    const block = projectLlm ? asRecord(projectLlm[vendor]) : null;
    const cliPath = optionalString(block?.cli_path) ?? (vendor === "claude" ? optionalString(legacyClaude?.cli_path) : null);
    const endpoint = optionalString(block?.api_endpoint) ?? (vendor === "claude" ? optionalString(legacyClaude?.api_endpoint) : null);
    if (cliPath) llm.cliPaths[vendor] = cliPath;
    if (endpoint) llm.apiEndpoints[vendor] = endpoint;
  }
  const local = projectLlm ? asRecord(projectLlm.local) : null;
  llm.localHost = optionalString(local?.host);
  llm.localPort = optionalNumber(local?.port);
  const verifier = asRecord(local?.verifier);
  if (verifier && (verifier.host !== undefined || verifier.port !== undefined)) {
    llm.localVerifier = { host: optionalString(verifier.host), port: optionalNumber(verifier.port) };
  }
  llm.googleApiKeyEnv = optionalString((projectLlm ? asRecord(projectLlm.google) : null)?.apiKeyEnv);
  const projectWeb = effective ? asRecord(effective.web) : null;
  const webAuthDisabled = projectWeb?.auth === false;
  const projectConfigRelevant =
    Object.keys(llm.cliPaths).length > 0 || Object.keys(llm.apiEndpoints).length > 0
    || llm.localHost !== null || llm.localPort !== null || llm.googleApiKeyEnv !== null || webAuthDisabled;
  if (projectConfigRelevant && !sources.includes(relOf(root, layout.configFile))) sources.push(relOf(root, layout.configFile));

  // What the assistants themselves read from the checkout: Claude Code's
  // project settings and hooks, Codex's project config. Hashed whole — any
  // change to them is a change to what an assistant may do unprompted.
  const assistantFiles: RepoAssistantFile[] = [];
  const claudeSettingsPath = join(root, ".claude", "settings.json");
  const claudeSettingsHash = hashFile(claudeSettingsPath);
  if (claudeSettingsHash) assistantFiles.push({ path: ".claude/settings.json", sha256: claudeSettingsHash });
  const claudeSettings = claudeSettingsHash ? readClaudeSettings(claudeSettingsPath) : null;
  for (const file of listFilesUnder(join(root, ".claude", "hooks"))) {
    const hash = hashFile(file);
    if (hash) assistantFiles.push({ path: relOf(root, file), sha256: hash });
  }
  const codexConfigHash = hashFile(join(root, ".codex", "config.toml"));
  if (codexConfigHash) assistantFiles.push({ path: ".codex/config.toml", sha256: codexConfigHash });
  for (const file of assistantFiles) sources.push(file.path);

  // The PRD is repository content too, and a saved `run` block steers the
  // next run of the item it sits on.
  const prdRunBlocks = scanPrdRunBlocks(root, layout.rexDir);
  for (const block of prdRunBlocks) sources.push(block.path);

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
  // Hench's API loop sends the variable `apiKeyEnv` names as the Anthropic
  // key. The default names nothing new, and leaving it out keeps the digest
  // of every checkout `hench init` wrote it into.
  const henchApiKeyEnv = optionalString(merged.apiKeyEnv);
  const credentialRouting = [
    ...credentialRoutingIn(effective),
    ...(henchApiKeyEnv && henchApiKeyEnv !== DEFAULT_HENCH_API_KEY_ENV ? [`hench.apiKeyEnv = ${henchApiKeyEnv}`] : []),
  ].sort();
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

  const mcpPath = join(root, PROJECT_MCP_CONFIG);
  const mcpConfig = readJson(mcpPath);
  const mcpServers: RepoMcpServer[] = [];
  if (mcpConfig) {
    sources.push(PROJECT_MCP_CONFIG);
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
    // The same rule holds for every field added since: a key enters the body
    // only when the checkout sets it.
    ...(envAllow.length ? { envAllow: [...envAllow].sort() } : {}),
    // Present only when set, for the same reason.
    ...(credentialRouting.length ? { credentialRouting } : {}),
    ...(vendorCliPaths.length ? { vendorCliPaths } : {}),
    permissionMode: optionalString(merged.permissionMode),
    provider: optionalString(merged.provider),
    ...(posture.autonomous !== null ? { autonomous: posture.autonomous } : {}),
    ...(posture.autoCommit !== null ? { autoCommit: posture.autoCommit } : {}),
    ...(posture.skipFullTestGate !== null ? { skipFullTestGate: posture.skipFullTestGate } : {}),
    ...(posture.apiKeyEnv !== null ? { apiKeyEnv: posture.apiKeyEnv } : {}),
    ...(posture.claudePath !== null ? { claudePath: posture.claudePath } : {}),
    ...(Object.keys(llm.cliPaths).length ? { cliPaths: llm.cliPaths } : {}),
    ...(Object.keys(llm.apiEndpoints).length ? { apiEndpoints: llm.apiEndpoints } : {}),
    ...(llm.localHost !== null ? { localHost: llm.localHost } : {}),
    ...(llm.localPort !== null ? { localPort: llm.localPort } : {}),
    ...(llm.localVerifier ? { localVerifier: llm.localVerifier } : {}),
    ...(llm.googleApiKeyEnv !== null ? { googleApiKeyEnv: llm.googleApiKeyEnv } : {}),
    ...(webAuthDisabled ? { webAuthDisabled } : {}),
    ...(assistantFiles.length ? { assistantFiles } : {}),
    ...(prdRunBlocks.length ? { prdRunBlocks } : {}),
    testCommand: projectTest ?? optionalString(rexConfig?.test),
    // Present only when set, for the same reason as `envAllow`.
    ...(gateTestCommands.length ? { gateTestCommands } : {}),
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
    localConfigUnanswered,
    localConfigTrackedPaths,
    localConfigNestedIn,
    gateTestCommands,
    posture, llm, webAuthDisabled, assistantFiles, claudeSettings, prdRunBlocks,
    digest: createHash("sha256").update(toCanonicalJSON(body)).digest("hex"),
  };
}

/**
 * Whether a caller should clamp what it reads from the checkout: the
 * repository deviates from the baseline and this user has not accepted its
 * current digest. The same decision as {@link evaluateRepoTrust}`.restricted`
 * without the inventory, for readers that run on every config load.
 */
export function isRepoRestricted(projectDir: string, options: RepoTrustStoreOptions = {}): boolean {
  const config = collectRepoExecutionConfig(projectDir);
  const deviates = assessRepoExecutionConfig(config).some((f) => f.severity === "warning");
  if (!deviates) return false;
  const record = readRepoTrustRecord(projectDir, options);
  return !record || record.digest !== config.digest;
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
  /** `hench.autonomous`, `autoCommit` or `skipFullTestGate` is on. */
  | "run-posture"
  /** `hench.apiKeyEnv` or `llm.google.apiKeyEnv` names a variable that is not an API key. */
  | "api-key-env"
  /** `hench.claudePath` or `llm.<vendor>.cli_path` chooses the binary n-dx executes. */
  | "cli-path"
  /** `llm.<vendor>.api_endpoint` or `llm.local.host` redirects API calls carrying a key. */
  | "api-endpoint"
  /** `web.auth` is false: the dashboard and hub start without the per-user token. */
  | "web-auth-disabled"
  /** `.claude/settings.json` grants tools, a default mode, hooks or environment unprompted. */
  | "assistant-settings"
  /** `.claude/hooks/**` or `.codex/config.toml` ships code or policy an assistant runs. */
  | "assistant-hooks"
  /** A saved PRD `run` block carries an execution-posture setting. */
  | "run-settings"
  | "local-config-tracked";

/** `apiKeyEnv` values that name an API key by convention need no review. */
const API_KEY_ENV_SHAPE = /^[A-Z0-9_]*API_KEY$/;

/** Hosts `llm.local` is expected to point at. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The bare command a vendor CLI resolves to on PATH; anything else chooses the binary. */
function isBareVendorCommand(vendor: string, value: string): boolean {
  return value === vendor;
}

/** The keys of a saved `run` block that set execution posture rather than a model. */
function runBlockPostureKeys(run: unknown): string[] {
  const block = asRecord(run);
  if (!block) return [];
  const keys: string[] = [];
  if (typeof block.permissionMode === "string") keys.push(`permissionMode=${block.permissionMode}`);
  if (block.skipTestGate === true) keys.push("skipTestGate=true");
  if (block.tokenBudget === 0) keys.push("tokenBudget=0");
  return keys;
}

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

/**
 * A repository-chosen path as one POSIX shell word, so advice the user pastes
 * (`git rm --cached -- …`) cannot run what a crafted file name spells.
 */
function shellArg(path: string): string {
  return /^[\w./@+-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
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
      // A warning, not a note: a guard that drops the credential-file blocks
      // is wider than the baseline, and the clamp is what keeps them blocked
      // until the user accepts that.
      findings.push({
        code: "secret-paths-unblocked",
        severity: "warning",
        message: "Does not block credential files (.env, keys); the current defaults do. Blocked until trusted.",
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
      message: `Chooses a program n-dx runs (vendor CLI, graview binary or face): ${config.vendorCliPaths.join(", ")}`,
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

  const postureOn = (["autonomous", "autoCommit", "skipFullTestGate"] as const).filter((k) => config.posture[k] === true);
  if (postureOn.length) {
    findings.push({
      code: "run-posture",
      severity: "warning",
      message: `Turns on unattended-run settings: ${postureOn.join(", ")}`,
      values: [...postureOn],
    });
  }

  const oddKeyEnvs = [
    ...(config.posture.apiKeyEnv && !API_KEY_ENV_SHAPE.test(config.posture.apiKeyEnv) ? [`hench.apiKeyEnv=${config.posture.apiKeyEnv}`] : []),
    ...(config.llm.googleApiKeyEnv && !API_KEY_ENV_SHAPE.test(config.llm.googleApiKeyEnv) ? [`llm.google.apiKeyEnv=${config.llm.googleApiKeyEnv}`] : []),
  ];
  if (oddKeyEnvs.length) {
    findings.push({
      code: "api-key-env",
      severity: "warning",
      message: `Sends an environment variable that is not named like an API key as the API key: ${oddKeyEnvs.join(", ")}`,
      values: oddKeyEnvs,
    });
  }

  const cliPaths = [
    ...(config.posture.claudePath && !isBareVendorCommand("claude", config.posture.claudePath) ? [`hench.claudePath=${config.posture.claudePath}`] : []),
    ...Object.entries(config.llm.cliPaths)
      .filter(([vendor, path]) => !isBareVendorCommand(vendor, path))
      .map(([vendor, path]) => `llm.${vendor}.cli_path=${path}`),
  ];
  if (cliPaths.length) {
    findings.push({
      code: "cli-path",
      severity: "warning",
      message: `Chooses the vendor CLI binary n-dx executes: ${cliPaths.join(", ")}`,
      values: cliPaths,
    });
  }

  const endpoints = [
    ...Object.entries(config.llm.apiEndpoints).map(([vendor, url]) => `llm.${vendor}.api_endpoint=${url}`),
    ...(config.llm.localHost && !LOOPBACK_HOSTS.has(config.llm.localHost.toLowerCase()) ? [`llm.local.host=${config.llm.localHost}`] : []),
    ...(config.llm.localVerifier?.host && !LOOPBACK_HOSTS.has(config.llm.localVerifier.host.toLowerCase())
      ? [`llm.local.verifier.host=${config.llm.localVerifier.host}`] : []),
  ];
  if (endpoints.length) {
    findings.push({
      code: "api-endpoint",
      severity: "warning",
      message: `Sends API requests, and the key they carry, to a configured endpoint: ${endpoints.join(", ")}`,
      values: endpoints,
    });
  }

  if (config.webAuthDisabled) {
    findings.push({
      code: "web-auth-disabled",
      severity: "warning",
      message: "Sets web.auth to false, so the dashboard and hub start without the per-user token",
      values: ["web.auth=false"],
    });
  }

  if (config.claudeSettings) {
    const s = config.claudeSettings;
    const grants = [
      ...(s.allow.length ? [`${s.allow.length} permissions.allow entr${s.allow.length === 1 ? "y" : "ies"}`] : []),
      ...(s.defaultMode ? [`permissions.defaultMode=${s.defaultMode}`] : []),
      ...(s.hooks ? ["hooks"] : []),
      ...(s.env.length ? [`env: ${s.env.join(", ")}`] : []),
    ];
    if (grants.length) {
      findings.push({
        code: "assistant-settings",
        severity: "warning",
        message: `.claude/settings.json grants the assistant without asking: ${grants.join("; ")}`,
        values: [...s.allow, ...(s.defaultMode ? [`defaultMode=${s.defaultMode}`] : []), ...(s.hooks ? ["hooks"] : []), ...s.env.map((e) => `env.${e}`)],
      });
    }
  }

  const hookFiles = config.assistantFiles.filter((f) => f.path !== ".claude/settings.json").map((f) => f.path);
  if (hookFiles.length) {
    findings.push({
      code: "assistant-hooks",
      severity: "warning",
      message: `Ships assistant hooks or policy an assistant runs from the checkout: ${hookFiles.join(", ")}`,
      values: hookFiles,
    });
  }

  const posturedBlocks = config.prdRunBlocks
    .map((b) => ({ path: b.path, keys: runBlockPostureKeys(b.run) }))
    .filter((b) => b.keys.length > 0);
  if (posturedBlocks.length) {
    const shown = posturedBlocks.map((b) => `${b.path}: ${b.keys.join(", ")}`);
    findings.push({
      code: "run-settings",
      severity: "warning",
      message: `Saves run settings on PRD items that set execution posture: ${shown.join("; ")}`,
      values: shown,
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
    // What git tracks, which is what `git rm --cached` must name: a case
    // variant, or a symlinked directory and its target, is not the path n-dx opens.
    const committed = config.localConfigTrackedPaths.length ? config.localConfigTrackedPaths : [file];
    const opened = committed.length === 1 && committed[0] === file ? "" : `, which n-dx opens as ${file}`;
    findings.push({
      code: "local-config-tracked",
      severity: "warning",
      message: config.localConfigUnanswered
        ? `git could not confirm ${file} is untracked (${config.localConfigUnanswered}), so it is treated as repository config; its settings apply only once trusted`
        : config.localConfigNestedIn
          ? `Ships ${file} inside ${config.localConfigNestedIn}, a submodule or nested repository, so it is repository config rather than yours; its settings apply only once trusted`
          : `Commits ${committed.join(", ")}${opened}, the machine-local config n-dx otherwise applies as yours; its settings apply only once trusted`,
      values: config.localConfigUnanswered || config.localConfigNestedIn ? [file] : committed,
    });
  }

  for (const { key, command } of config.gateTestCommands) {
    const risky = SHELL_RISK.test(command);
    findings.push({
      code: "test-command",
      severity: risky ? "warning" : "info",
      message: risky
        ? `Defines a command hench's test gate runs (hench.${key}) that chains or fetches: ${command}`
        : `Defines a command hench's test gate runs (hench.${key}): ${command}`,
      values: [command],
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
    if (ev.config.gateTestCommands.length) {
      lines.push("  hench's test gate ignores the repository's test commands and auto-detects one instead.");
    }
    const tracked = ev.findings.find((f) => f.code === "local-config-tracked");
    if (tracked && ev.config.localConfigUnanswered) {
      // git rm --cached would fail with the same error, and the file may not be committed.
      lines.push(`  ${tracked.values[0]} is ignored too, because git could not say whether the repository commits it.`);
      lines.push(`  Fix git (e.g. git config --global --add safe.directory <this checkout>), or accept the configuration.`);
    } else if (tracked && ev.config.localConfigNestedIn) {
      // git rm --cached in this checkout cannot untrack a file another repository ships.
      lines.push(`  ${tracked.values[0]} is ignored too: it comes from ${ev.config.localConfigNestedIn}, a submodule or nested repository,`);
      lines.push(`  so git rm --cached here cannot untrack it. Accept the configuration to apply it.`);
    } else if (tracked) {
      lines.push(`  The committed ${tracked.values.join(", ")} is ignored too, as repository config. To keep settings of your own,`);
      lines.push(`  untrack it (git rm --cached -- ${tracked.values.map(shellArg).join(" ")}) and keep it ignored, or accept the configuration.`);
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
