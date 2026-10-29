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
import { GuardError } from "./paths.js";

/** What a tool spawn site needs: wrap one argv, and say what it is running under. */
export interface ToolSandbox {
  wrap(file: string, args: readonly string[]): SandboxedInvocation;
  /** Wrap a shell command string in the shell `execShellCmd` would use. */
  wrapShell(command: string): SandboxedInvocation;
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
 * the project is a linked worktree, read-only access to the toolchain and the
 * n-dx install its MCP servers start from, TLS and loopback network, and no
 * access to the operator's other credential directories.
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
  // On macOS the CLI reads its login with `security find-generic-password`,
  // which opens the login keychain under ~/Library/Keychains. Items there are
  // guarded per application by the keychain's own access lists, so granting
  // the directory exposes only what the operator's `claude` could already read.
  if (process.platform === "darwin") readWriteRoots.push(join(home, "Library", "Keychains"));
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
