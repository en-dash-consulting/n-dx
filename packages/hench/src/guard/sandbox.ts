/**
 * OS-level confinement for the processes hench's tools start.
 *
 * The command allowlist in `commands.ts` decides which executable may run;
 * it cannot bound what that executable does, because the language baseline
 * has to include the project's own interpreter. This module wraps every
 * `run_command` and `git` child in the operating system's sandbox (Seatbelt
 * on macOS, bubblewrap on Linux) so the boundary holds whatever the command:
 * read-write to the project and a private scratch directory, read-only to
 * the toolchain, no access to the operator's credential directories or to
 * hench's own state, and no network unless the operator allows it.
 *
 * The on/off setting is read by `resolveSandboxSetting` from the environment,
 * `.n-dx.local.json` or the user config in ndx home — never from a tracked
 * file — so a repository cannot switch confinement off.
 *
 * @module
 */

import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import {
  LLM_VENDOR,
  getGitCommonDir,
  detectSandboxBackend,
  nodeToolchainRoots,
  resolveSandboxSetting,
  wrapInSandbox,
  wrapShellInSandbox,
} from "../prd/llm-gateway.js";
import type {
  SandboxBackend,
  SandboxPolicy,
  SandboxSetting,
  SandboxedInvocation,
} from "../prd/llm-gateway.js";
// Through hench's exec module, so a test that stubs it stubs these spawns too.
import { exec, execShellCmd } from "../process/exec.js";
import type { ExecOptions, ExecResult } from "../process/exec.js";
import { reclaimHostValidationSlot, withHostValidationSlotDir } from "../process/validation-run.js";
import { hostIdentity, type HostIdentityCache } from "../process/validation-slot-dir.js";
import { GuardError } from "./paths.js";

/** What a tool spawn site needs: wrap one argv, and say what it is running under. */
export interface ToolSandbox {
  wrap(file: string, args: readonly string[]): SandboxedInvocation;
  /** Wrap a shell command string in the shell `execShellCmd` would use. */
  wrapShell(command: string): SandboxedInvocation;
  /**
   * Await before each confined spawn, and spawn with the environment it
   * returns: clears a stale validation-slot holder that the confined command
   * could not judge (`reclaimHostValidationSlot`), and returns `base` with
   * the host-resolved slot directory in `NDX_VALIDATION_SLOT_DIR`
   * (`withHostValidationSlotDir`). Never throws, and never waits on the host
   * lookup.
   */
  prepareSpawn(base: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv>;
  readonly backend: SandboxBackend;
  readonly setting: SandboxSetting;
  readonly tmpDir: string;
  /** Remove the private scratch directory. Safe to call more than once. */
  dispose(): void;
}

/** How a run stands on confinement, for the posture line and the run record. */
export interface SandboxPosture {
  state: "confined" | "off" | "unavailable";
  backend: SandboxBackend["name"];
  network: SandboxSetting["toolNetwork"];
  source: SandboxSetting["source"];
  reason?: string;
}

export interface CreateToolSandboxOptions {
  env?: NodeJS.ProcessEnv;
  ndxHome?: string;
  /** Injected for tests; defaults to probing this host. */
  backend?: SandboxBackend;
  /** Injected for tests; defaults to `resolveSandboxSetting`. */
  setting?: SandboxSetting;
  /** Injected for tests; defaults to `reclaimHostValidationSlot`. Must never throw. */
  reclaimSlot?: (env: NodeJS.ProcessEnv) => Promise<void>;
  /** Injected for tests; defaults to this process's host identity cache. */
  hostIdentity?: Pick<HostIdentityCache, "peek">;
}

/** Clear a stale holder from the host view, as `prepareSpawn` does. */
function reclaimSlot(options: CreateToolSandboxOptions): Promise<void> {
  const env = options.env ?? process.env;
  return options.reclaimSlot ? options.reclaimSlot(env) : reclaimHostValidationSlot(env, options.hostIdentity);
}

/** The `prepareSpawn` of a sandbox built with `options`. */
function spawnPreparer(options: CreateToolSandboxOptions): (base: NodeJS.ProcessEnv) => Promise<NodeJS.ProcessEnv> {
  const hostEnv = options.env ?? process.env;
  // Started now, so the identity is usually known by the first spawn.
  (options.hostIdentity ?? hostIdentity).peek();
  return async (base) => {
    await reclaimSlot(options);
    return withHostValidationSlotDir(base, hostEnv, options.hostIdentity);
  };
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Resolve the operator's setting and this host's backend into a posture,
 * without creating anything. Used both to build the sandbox and to refuse
 * an autonomous run before it starts.
 */
export function resolveSandboxPosture(
  projectDir: string,
  options: CreateToolSandboxOptions = {},
): { posture: SandboxPosture; setting: SandboxSetting; backend: SandboxBackend } {
  const setting = options.setting ?? resolveSandboxSetting(projectDir, { env: options.env, ndxHome: options.ndxHome });
  const backend = options.backend ?? detectSandboxBackend();
  const base = { backend: backend.name, network: setting.toolNetwork, source: setting.source };
  if (setting.mode === "off") return { posture: { ...base, state: "off" }, setting, backend };
  if (!backend.available) return { posture: { ...base, state: "unavailable", reason: backend.reason }, setting, backend };
  return { posture: { ...base, state: "confined" }, setting, backend };
}

/**
 * Build the sandbox for a run's tool children, or `null` when the operator
 * turned it off or the host has no usable backend. Callers that must not run
 * unconfined (autonomous modes) check {@link assertSandboxReady} first.
 */
export function createToolSandbox(
  projectDir: string,
  options: CreateToolSandboxOptions = {},
): ToolSandbox | null {
  const { posture, setting, backend } = resolveSandboxPosture(projectDir, options);
  if (posture.state !== "confined") return null;

  const realProject = realOr(projectDir);
  const tmpDir = realOr(mkdtempSync(join(tmpdir(), "hench-sbx-")));
  const env = options.env ?? process.env;
  const policy: SandboxPolicy = {
    kind: "tool",
    projectDir: realProject,
    tmpDir,
    network: setting.toolNetwork,
    homeDir: realOr(homedir()),
    // git reads the operator's identity from here; `.config/git/credentials`
    // stays denied by the policy's credential list, which is applied last.
    readOnlyRoots: [
      ...nodeToolchainRoots(env).map(realOr),
      join(realOr(homedir()), ".gitconfig"),
      join(realOr(homedir()), ".config", "git"),
    ],
  };

  let disposed = false;
  const sandbox: ToolSandbox = {
    backend,
    setting,
    tmpDir,
    wrap: (file, args) => wrapInSandbox(file, args, policy, backend),
    wrapShell: (command) => wrapShellInSandbox(command, policy, backend),
    prepareSpawn: spawnPreparer(options),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      openSandboxes.delete(sandbox);
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
  trackForExit(sandbox);
  return sandbox;
}

/**
 * Run a shell command from the repository — the test gate, the completion
 * check's test command, a requirement's validation command, a transformation
 * batch's typecheck — inside the same `tool`-kind sandbox the agent's own
 * `run_command` gets.
 *
 * These commands execute code the agent wrote (its tests, its build scripts)
 * or chose (a requirement command stored in the PRD), but hench starts them
 * itself, after the agent's turn, so without this they ran with the
 * operator's full filesystem and network access: a test that reads `~/.ssh`
 * and posts it out was blocked when the agent ran it and succeeded in the
 * gate. The same posture applies — when the operator turned the sandbox off,
 * or the host has no backend, the command runs unconfined, which the run's
 * posture line already reports.
 *
 * The sandbox is built per call and removed afterwards. npm's cache moves
 * into its scratch directory, because the home directory is not writable.
 * Never throws for a command failure; the result is `execShellCmd`'s.
 *
 * Every call first clears a stale validation-slot holder from the host view,
 * confined or not: these are hench's own validation steps, so during a
 * vendor-CLI session (one sandbox for the whole session) they are where a
 * holder that died on the host is cleared for the session's confined runners.
 */
export async function execRepoShellCmd(
  command: string,
  opts: ExecOptions,
  sandboxOptions: CreateToolSandboxOptions = {},
): Promise<ExecResult> {
  const sandbox = createToolSandbox(opts.cwd, sandboxOptions);
  if (!sandbox) {
    await reclaimSlot(sandboxOptions);
    return execShellCmd(command, opts);
  }
  try {
    const base = await sandbox.prepareSpawn(opts.env ?? process.env);
    const inv = sandbox.wrapShell(command);
    const env = {
      ...base,
      ...inv.env,
      npm_config_cache: join(sandbox.tmpDir, "npm-cache"),
    };
    return await exec(inv.file, inv.args, { ...opts, env });
  } finally {
    sandbox.dispose();
  }
}

/** Sandboxes whose scratch directory still exists; removed at process exit. */
const openSandboxes = new Set<ToolSandbox>();
let exitHookInstalled = false;

function trackForExit(sandbox: ToolSandbox): void {
  openSandboxes.add(sandbox);
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const s of [...openSandboxes]) {
      try { s.dispose(); } catch { /* best effort at exit */ }
    }
  });
}

/**
 * The highest ancestor of `path` (below the filesystem root and the home
 * directory itself) that holds a `node_modules` — the root an installed or
 * linked `ndx` resolves its own dependencies from. Read-only to the vendor
 * CLI, which starts n-dx's MCP servers from there.
 */
function installRoot(path: string, home: string): string {
  let dir = dirname(path);
  let best = dir;
  while (dir !== dirname(dir) && dir !== home) {
    if (existsSync(join(dir, "node_modules"))) best = dir;
    dir = dirname(dir);
  }
  return best;
}

export interface CreateVendorCliSandboxOptions extends CreateToolSandboxOptions {
  /** Path the vendor CLI was resolved to; its install directory is made readable. */
  cliBinary: string;
}

/**
 * Whether `vendor` runs its session inside its own sandbox under the
 * operator's confinement setting: Codex, unless that setting is off. Such a
 * session gets the host-resolved validation slot directory like one we
 * confine, because a lookup inside its sandbox may be refused. No backend is
 * needed: Codex brings its own.
 */
export function isSelfConfinedVendorSession(
  projectDir: string,
  vendor: string,
  options: Pick<CreateToolSandboxOptions, "env" | "ndxHome" | "setting"> = {},
): boolean {
  if (vendor !== LLM_VENDOR.CODEX) return false;
  const setting = options.setting ?? resolveSandboxSetting(projectDir, { env: options.env, ndxHome: options.ndxHome });
  return setting.mode !== "off";
}

/**
 * Build the sandbox the vendor CLI runs inside, or null when it should run
 * unconfined by us:
 *
 * - **Codex** confines itself (`--sandbox workspace-write`, network off), and
 *   Seatbelt cannot nest, so wrapping it would break its own sandbox.
 * - **Off or unavailable** as for tool children; the autonomous refusal is
 *   applied by the caller through {@link assertSandboxReady}.
 *
 * The Claude CLI gets the project read-write (except hench's own config),
 * its config directory and `~/.claude.json`, the git common directory when
 * the project is a linked worktree, read-only access to the toolchain, the
 * n-dx install its MCP servers start from and (macOS) the keychain
 * directory, the vendor network profile, and no access to the operator's
 * other credential directories.
 */
export function createVendorCliSandbox(
  projectDir: string,
  vendor: string,
  options: CreateVendorCliSandboxOptions,
): ToolSandbox | null {
  if (vendor !== LLM_VENDOR.CLAUDE) return null;
  const { posture, setting, backend } = resolveSandboxPosture(projectDir, options);
  if (posture.state !== "confined") return null;

  const env = options.env ?? process.env;
  const home = realOr(homedir());
  const realProject = realOr(projectDir);
  const tmpDir = realOr(mkdtempSync(join(tmpdir(), "hench-cli-sbx-")));
  const configDir = env.CLAUDE_CONFIG_DIR ? realOr(env.CLAUDE_CONFIG_DIR) : join(home, ".claude");
  const readWriteRoots = [configDir];
  const common = getGitCommonDir(realProject);
  if (common) {
    const realCommon = realOr(common);
    if (relative(realProject, realCommon).startsWith("..")) readWriteRoots.push(realCommon);
  }
  const readOnlyRoots = [
    ...nodeToolchainRoots(env).map(realOr),
    installRoot(realOr(options.cliBinary), home),
    join(home, ".gitconfig"),
    join(home, ".config", "git"),
  ];
  // On macOS the CLI reads and refreshes its login with `security`, which
  // locates the login keychain under ~/Library/Keychains and then reaches the
  // items through securityd, which owns the keychain files and does the
  // writes. The directory is therefore readable and never writable: a
  // confined process cannot replace or append to the keychain files.
  //
  // Residual risk: securityd still answers this process and every Bash child
  // the CLI starts, so `security find-generic-password -w` returns any item
  // whose access list trusts `/usr/bin/security` or allows all applications
  // (go-keyring, which `gh` uses, stores its token that way), whatever the
  // file permissions. Keep such tokens out of the login keychain, or run
  // with a vendor that confines itself, where that matters. SECURITY.md
  // states the same.
  if (process.platform === "darwin") readOnlyRoots.push(join(home, "Library", "Keychains"));
  const ndxCli = env.NDX_CLI_PATH ?? env.N_DX_CLI_PATH;
  if (ndxCli) readOnlyRoots.push(installRoot(realOr(ndxCli), home));

  const policy: SandboxPolicy = {
    kind: "vendor-cli",
    projectDir: realProject,
    tmpDir,
    network: setting.toolNetwork === "allow" ? "allow" : "vendor",
    homeDir: home,
    readOnlyRoots,
    readWriteRoots,
    readWritePrefixes: [join(home, ".claude.json")],
  };

  // The Claude CLI keeps its temp files under `/tmp/claude-<uid>` unless
  // CLAUDE_CODE_TMPDIR names another root. That path is outside the profile,
  // so the open is refused; point the CLI at the sandbox's scratch directory.
  const claudeTmpEnv = { CLAUDE_CODE_TMPDIR: tmpDir, CLAUDE_TMPDIR: tmpDir };
  const withClaudeTmp = (inv: SandboxedInvocation): SandboxedInvocation => ({ ...inv, env: { ...inv.env, ...claudeTmpEnv } });

  let disposed = false;
  const sandbox: ToolSandbox = {
    backend,
    setting,
    tmpDir,
    wrap: (file, args) => withClaudeTmp(wrapInSandbox(file, args, policy, backend)),
    wrapShell: (command) => withClaudeTmp(wrapShellInSandbox(command, policy, backend)),
    prepareSpawn: spawnPreparer(options),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      openSandboxes.delete(sandbox);
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
  trackForExit(sandbox);
  return sandbox;
}

/**
 * Refuse to start an autonomous run that would execute unconfined.
 *
 * The operator can still choose to: `NDX_SANDBOX=off`, or `"sandbox": {
 * "mode": "off" }` in `.n-dx.local.json` or the user config. What they cannot
 * do is get an unconfined autonomous run by accident, on a host where the
 * backend is missing.
 *
 * @throws {GuardError} naming the reason and the opt-out.
 */
export function assertSandboxReady(posture: SandboxPosture, autonomous: boolean): void {
  if (!autonomous || posture.state !== "unavailable") return;
  throw new GuardError(
    `Autonomous runs execute agent commands inside an OS sandbox, and none is usable here: ${posture.reason ?? "no backend"}. ` +
    `Install the backend (macOS: built in; Linux: bubblewrap), or run attended, or opt out explicitly with ` +
    `NDX_SANDBOX=off or "sandbox": { "mode": "off" } in .n-dx.local.json.`,
  );
}

/** One line for the run's output and record. */
export function formatSandboxPosture(posture: SandboxPosture): string {
  switch (posture.state) {
    case "confined":
      return `sandbox: on (${posture.backend}, tool network ${posture.network}${posture.source === "default" ? "" : `, from ${posture.source}`})`;
    case "off":
      return `sandbox: OFF (set by ${posture.source}) — agent commands run with your full user permissions`;
    case "unavailable":
      return `sandbox: unavailable (${posture.reason ?? "no backend"}) — agent commands run with your full user permissions`;
  }
}
