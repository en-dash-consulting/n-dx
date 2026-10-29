/**
 * OS-level confinement for the processes an agent run starts.
 *
 * Hench's in-process guard decides *which* commands may run; it cannot decide
 * what a command does once it is running, because the baseline allowlist has
 * to contain the project's own interpreter (`node`, `go`, `swift`). The only
 * boundary that holds against an allowlisted interpreter is one the operating
 * system enforces around the child process. This module builds that boundary
 * once, from one policy, for every spawn an agent run makes: hench's own tool
 * children on the API loop, and the vendor CLI on the CLI loop.
 *
 * The policy is deliberately small:
 *
 * - **Filesystem.** Read and write only the project directory and a private
 *   scratch directory. Read the toolchain (`/usr`, `/bin`, the Node install,
 *   the package store). Nothing under the operator's home except what the
 *   policy names. Project state the agent must not touch (`.hench/`, `.rex/`,
 *   the `.ndx/` container) is masked for tool children; the vendor CLI keeps
 *   `.rex/` because the rex MCP server it starts writes the PRD there.
 * - **Network.** `none` for tool children — the parent makes the LLM calls,
 *   a test suite or build has no business on the network. `vendor` for the
 *   vendor CLI: TLS to port 443 and loopback, which is as narrow as a
 *   per-process sandbox can draw it without a resolver (neither Seatbelt nor
 *   bubblewrap filters by hostname). `allow` is the operator's relaxation.
 * - **Backends.** Seatbelt (`sandbox-exec`) on macOS, bubblewrap (`bwrap`) on
 *   Linux. Windows has no backend yet; {@link detectSandboxBackend} says so
 *   and the caller decides whether to refuse or to run unconfined with a
 *   warning. That decision is the caller's because it depends on the run
 *   mode (an attended run may proceed; an autonomous one should not).
 *
 * Everything here is a pure function of its inputs except
 * {@link detectSandboxBackend}, whose probes are injectable. Real paths are
 * required: Seatbelt matches the resolved path (`/private/tmp`, not `/tmp`),
 * so a caller passes `realpathSync` output.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { buildShellInvocation, execFileSyncCli, isExecutableOnPath } from "./exec.js";
import { NDX_CONTAINER_DIRNAME, resolveLayout, resolveNdxHome } from "./layout.js";

/**
 * Which spawn the policy confines; decides what project state stays visible.
 * `git-hook` is a repository hook run for a commit hench makes itself: it sees
 * the whole project, because the commit stages the PRD hench wrote and a hook
 * may reformat staged files, but hench's own state stays read-only to it.
 */
export type SandboxSpawnKind = "tool" | "vendor-cli" | "git-hook";

/** Network reach a confined process gets. */
export type SandboxNetwork = "none" | "vendor" | "allow";

export interface SandboxPolicy {
  kind: SandboxSpawnKind;
  /** Real path of the project directory: read-write. */
  projectDir: string;
  /** Real path of a private scratch directory: read-write; also becomes TMPDIR. */
  tmpDir: string;
  network: SandboxNetwork;
  /** Real path of the operator's home. Only its credential directories are named in the profile; the rest is unreachable by default. */
  homeDir?: string;
  /** Extra read-only roots: the Node install, the package store, a language toolchain. Real paths. */
  readOnlyRoots?: readonly string[];
  /** Extra read-write roots a vendor CLI needs (its config directory). Real paths. */
  readWriteRoots?: readonly string[];
  /**
   * Read-write path prefixes for files a vendor CLI rewrites by temp-and-rename
   * beside the original (`~/.claude.json` → `~/.claude.json.tmp.123`). Seatbelt
   * matches them as a prefix; bubblewrap binds the exact path when it exists.
   */
  readWritePrefixes?: readonly string[];
}

export type SandboxBackendName = "seatbelt" | "bwrap" | "none";

export interface SandboxBackend {
  name: SandboxBackendName;
  /** False when the platform has no backend or the binary is missing; `reason` says which. */
  available: boolean;
  reason?: string;
}

/** Paths under a home directory that hold credentials; denied even when a read-only root reaches into the home. */
export const HOME_SECRET_DIRS: readonly string[] = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".netrc",
  ".npmrc",
  ".config/gh",
  ".config/git/credentials",
  ".docker/config.json",
  ".azure",
  ".gcloud",
  ".config/gcloud",
  "Library/Keychains",
];

/**
 * Project state a confined process must not touch, in both layouts, from the
 * layout resolver rather than spelled here. A tool child is kept out of all of
 * n-dx's state; the vendor CLI may read and write the PRD (the rex MCP server
 * it starts writes there) but not hench's own configuration.
 */
export function maskedProjectPathsFor(kind: SandboxSpawnKind, projectDir: string): string[] {
  const legacy = resolveLayout(projectDir, { mode: "legacy" });
  const ndx = resolveLayout(projectDir, { mode: "ndx" });
  if (kind === "tool") {
    return [legacy.henchDir, legacy.rexDir, join(projectDir, NDX_CONTAINER_DIRNAME)];
  }
  if (kind === "git-hook") return [];
  return [join(legacy.henchDir, "config.json"), join(ndx.henchDir, "config.json")];
}

/**
 * Project state a confined process may read but not write. A repository hook
 * run for hench's own commit reads the tree like any hook, but may not rewrite
 * hench's configuration and run records or the operator's local config (which
 * holds the sandbox setting itself).
 */
export function readOnlyProjectPathsFor(kind: SandboxSpawnKind, projectDir: string): string[] {
  if (kind !== "git-hook") return [];
  const legacy = resolveLayout(projectDir, { mode: "legacy" });
  const ndx = resolveLayout(projectDir, { mode: "ndx" });
  return [legacy.henchDir, ndx.henchDir, legacy.localConfigFile, ndx.localConfigFile];
}

/** System roots every confined process may read: the toolchain lives here on both platforms. */
const SYSTEM_READ_ROOTS_DARWIN: readonly string[] = [
  "/usr", "/bin", "/sbin", "/System", "/Library", "/private/etc", "/private/var/db", "/dev", "/opt",
  "/private/var/select", "/Applications/Xcode.app",
];
const SYSTEM_READ_ROOTS_LINUX: readonly string[] = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"];

/**
 * Which backend this host offers. Injectable probes keep it a pure function
 * for tests; the defaults ask the filesystem and PATH.
 */
export function detectSandboxBackend(
  platform: NodeJS.Platform = process.platform,
  probes: {
    exists?: (p: string) => boolean;
    onPath?: (name: string) => boolean;
    /**
     * Whether the backend can actually apply a profile here. Seatbelt refuses
     * to nest inside another Seatbelt sandbox, and bubblewrap needs user
     * namespaces, which many containers disable; a binary that exists but
     * cannot confine anything must not be reported as available.
     */
    usable?: (backend: "seatbelt" | "bwrap") => boolean;
  } = {},
): SandboxBackend {
  const exists = probes.exists ?? existsSync;
  const onPath = probes.onPath ?? isExecutableOnPath;
  const usable = probes.usable ?? probeBackendUsable;
  if (platform === "darwin") {
    if (!exists("/usr/bin/sandbox-exec")) {
      return { name: "seatbelt", available: false, reason: "/usr/bin/sandbox-exec is missing" };
    }
    return usable("seatbelt")
      ? { name: "seatbelt", available: true }
      : { name: "seatbelt", available: false, reason: "sandbox-exec cannot apply a profile here (already inside a sandbox?)" };
  }
  if (platform === "linux") {
    if (!onPath("bwrap")) {
      return { name: "bwrap", available: false, reason: "bubblewrap (bwrap) is not on PATH; install the bubblewrap package" };
    }
    return usable("bwrap")
      ? { name: "bwrap", available: true }
      : { name: "bwrap", available: false, reason: "bwrap cannot create a sandbox here (user namespaces disabled?)" };
  }
  return { name: "none", available: false, reason: `no sandbox backend for ${platform}` };
}

/** Memoized per process: whether a backend can apply a trivial profile. */
const usableCache = new Map<string, boolean>();

function probeBackendUsable(backend: "seatbelt" | "bwrap"): boolean {
  const cached = usableCache.get(backend);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    if (backend === "seatbelt") {
      execFileSyncCli("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/usr/bin/true"], { stdio: "ignore", timeout: 5000 });
    } else {
      execFileSyncCli("bwrap", ["--ro-bind", "/", "/", "--unshare-pid", "--", "/bin/true"], { stdio: "ignore", timeout: 5000 });
    }
    ok = true;
  } catch {
    ok = false;
  }
  usableCache.set(backend, ok);
  return ok;
}

// ── Operator setting ────────────────────────────────────────────────────────

export type OsSandboxMode = "on" | "off";

export interface SandboxSetting {
  mode: OsSandboxMode;
  /** Network reach for tool children. The vendor CLI always gets at least `vendor`. */
  toolNetwork: Extract<SandboxNetwork, "none" | "allow">;
  /** Where the effective values came from, for the run's posture line. */
  source: "default" | "env" | "local-config" | "user-config";
}

export const SANDBOX_MODE_ENV = "NDX_SANDBOX";
export const SANDBOX_NETWORK_ENV = "NDX_SANDBOX_NETWORK";

function readSandboxSection(path: string): { mode?: unknown; network?: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    const section = (parsed as Record<string, unknown>).sandbox;
    return section && typeof section === "object" ? (section as { mode?: unknown; network?: unknown }) : null;
  } catch {
    return null;
  }
}

/**
 * The operator's sandbox setting. Read only from places a repository cannot
 * write: the environment, the git-ignored `.n-dx.local.json`, and the user
 * config in ndx home. The tracked `.n-dx.json` and `.hench/config.json` are
 * deliberately not consulted, so a clone can never switch confinement off.
 * Earlier sources win; an unrecognised value is ignored, not trusted.
 */
export function resolveSandboxSetting(
  projectDir: string,
  options: { env?: NodeJS.ProcessEnv; ndxHome?: string } = {},
): SandboxSetting {
  const env = options.env ?? process.env;
  let mode: OsSandboxMode | undefined;
  let network: "none" | "allow" | undefined;
  let source: SandboxSetting["source"] = "default";

  const take = (m: unknown, n: unknown, from: SandboxSetting["source"]): void => {
    if (mode === undefined && (m === "on" || m === "off")) { mode = m; source = from; }
    if (network === undefined && (n === "none" || n === "allow")) { network = n; if (source === "default") source = from; }
  };

  take(env[SANDBOX_MODE_ENV], env[SANDBOX_NETWORK_ENV], "env");
  const local = readSandboxSection(resolveLayout(projectDir).localConfigFile);
  if (local) take(local.mode, local.network, "local-config");
  const home = options.ndxHome ?? resolveNdxHome({ env });
  const user = readSandboxSection(join(home, "config.json"));
  if (user) take(user.mode, user.network, "user-config");

  return { mode: mode ?? "on", toolNetwork: network ?? "none", source };
}

/** Quote a path for an SBPL string literal. */
function sbplString(p: string): string {
  return `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function maskedProjectPaths(policy: SandboxPolicy): string[] {
  return maskedProjectPathsFor(policy.kind, policy.projectDir);
}

/**
 * Credential directories denied to every confined process. The vendor CLI
 * keeps access to the macOS keychain, because that is where it stores its own
 * login; items there are protected per application by the keychain itself.
 */
function homeSecretPaths(policy: SandboxPolicy): string[] {
  if (!policy.homeDir) return [];
  const dirs = policy.kind === "vendor-cli" ? HOME_SECRET_DIRS.filter((d) => d !== "Library/Keychains") : HOME_SECRET_DIRS;
  return dirs.map((r) => resolve(policy.homeDir!, r));
}

/** Escape a path for an SBPL regex literal anchored at its start. */
function sbplPrefixRegex(p: string): string {
  return `(regex #"^${p.replace(/[\\^$.*+?()[\]{}|"]/g, "\\$&")}")`;
}

/**
 * The Seatbelt profile for a policy. Later rules win in SBPL, so the denies
 * for masked project state and credential directories come last and hold
 * even when a read-only root (an nvm install under the home, say) would
 * otherwise reach them.
 */
export function buildSeatbeltProfile(policy: SandboxPolicy): string {
  const lines: string[] = [
    "(version 1)",
    "(deny default)",
    "; process basics",
    "(allow process-fork)",
    "(allow process-exec*)",
    "(allow signal (target same-sandbox))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow ipc-posix-shm)",
    "(allow file-read-metadata)",
    "(allow file-ioctl (literal \"/dev/null\") (literal \"/dev/tty\"))",
    "(allow file-read* file-write* (literal \"/dev/null\") (literal \"/dev/tty\") (literal \"/dev/urandom\") (literal \"/dev/random\") (literal \"/dev/zero\"))",
    "(allow file-read* (literal \"/\") (literal \"/private\") (literal \"/Users\") (literal \"/private/tmp\") (literal \"/private/var\") (literal \"/private/var/folders\"))",
    "; toolchain",
  ];
  const roRoots = [...SYSTEM_READ_ROOTS_DARWIN, ...(policy.readOnlyRoots ?? [])];
  lines.push(`(allow file-read* ${roRoots.map((r) => `(subpath ${sbplString(r)})`).join(" ")})`);
  lines.push("; project and scratch");
  const rwRoots = [policy.projectDir, policy.tmpDir, ...(policy.readWriteRoots ?? [])];
  lines.push(`(allow file-read* file-write* ${rwRoots.map((r) => `(subpath ${sbplString(r)})`).join(" ")})`);
  if (policy.readWritePrefixes?.length) {
    lines.push(`(allow file-read* file-write* ${policy.readWritePrefixes.map(sbplPrefixRegex).join(" ")})`);
  }

  const readOnly = readOnlyProjectPathsFor(policy.kind, policy.projectDir);
  if (readOnly.length) {
    lines.push("; read-only project state");
    lines.push(`(deny file-write* ${readOnly.map((m) => `(subpath ${sbplString(m)}) (literal ${sbplString(m)})`).join(" ")})`);
  }

  lines.push("; network");
  switch (policy.network) {
    case "none":
      lines.push("(deny network*)");
      break;
    case "vendor":
      lines.push("(allow network-outbound (remote tcp \"*:443\"))");
      lines.push("(allow network-outbound (remote udp \"*:53\"))");
      lines.push("(allow network* (local ip \"localhost:*\"))");
      lines.push("(allow network-outbound (remote ip \"localhost:*\"))");
      lines.push("(allow network-outbound (remote unix-socket))");
      lines.push("(allow system-socket)");
      break;
    case "allow":
      lines.push("(allow network*)");
      lines.push("(allow system-socket)");
      break;
  }

  const masked = [...maskedProjectPaths(policy), ...homeSecretPaths(policy)];
  if (masked.length) {
    lines.push("; masked: project state and credentials (last so they win)");
    lines.push(`(deny file-read* file-write* ${masked.map((m) => `(subpath ${sbplString(m)}) (literal ${sbplString(m)})`).join(" ")})`);
  }
  return lines.join("\n") + "\n";
}

/**
 * bubblewrap arguments for a policy. The root is assembled from read-only
 * binds rather than a whole-root bind so the home directory is simply
 * absent; masked project state is covered by an empty tmpfs, which hides a
 * directory's contents and refuses writes to it.
 */
export function buildBwrapArgs(policy: SandboxPolicy, exists: (p: string) => boolean = existsSync): string[] {
  const args: string[] = ["--die-with-parent", "--new-session", "--unshare-pid"];
  for (const root of SYSTEM_READ_ROOTS_LINUX) {
    if (exists(root)) args.push("--ro-bind", root, root);
  }
  args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp");
  // A vendor CLI rewrites files in the home directory by temp-and-rename, so
  // it gets an empty, writable home that holds only what is bound into it
  // below; nothing it writes there outlives the spawn except the bound paths.
  if (policy.kind === "vendor-cli" && policy.homeDir) args.push("--tmpfs", policy.homeDir);
  for (const root of policy.readOnlyRoots ?? []) args.push("--ro-bind-try", root, root);
  args.push("--bind", policy.projectDir, policy.projectDir);
  args.push("--bind", policy.tmpDir, policy.tmpDir);
  for (const root of policy.readWriteRoots ?? []) args.push("--bind-try", root, root);
  for (const prefix of policy.readWritePrefixes ?? []) args.push("--bind-try", prefix, prefix);
  for (const path of readOnlyProjectPathsFor(policy.kind, policy.projectDir)) {
    if (exists(path)) args.push("--ro-bind", path, path);
  }
  for (const masked of maskedProjectPaths(policy)) {
    if (exists(masked)) args.push("--tmpfs", masked);
  }
  for (const secret of homeSecretPaths(policy)) {
    if (exists(secret)) args.push("--tmpfs", secret);
  }
  if (policy.network === "none") args.push("--unshare-net");
  args.push("--setenv", "TMPDIR", policy.tmpDir);
  args.push("--chdir", policy.projectDir);
  return args;
}

export interface SandboxedInvocation {
  file: string;
  args: string[];
  /** Environment additions the backend needs (TMPDIR for Seatbelt; bwrap sets its own). */
  env: Record<string, string>;
}

/**
 * Wrap a binary and its argv so the backend confines it. The returned
 * invocation goes to the same spawn helper the caller would have used; the
 * original argv is passed through verbatim, so no shell re-parses it.
 */
export function wrapInSandbox(
  file: string,
  args: readonly string[],
  policy: SandboxPolicy,
  backend: SandboxBackend,
): SandboxedInvocation {
  if (!backend.available) {
    throw new Error(`sandbox backend unavailable: ${backend.reason ?? backend.name}`);
  }
  if (backend.name === "seatbelt") {
    return {
      file: "/usr/bin/sandbox-exec",
      args: ["-p", buildSeatbeltProfile(policy), file, ...args],
      env: { TMPDIR: policy.tmpDir },
    };
  }
  if (backend.name === "bwrap") {
    return {
      file: "bwrap",
      args: [...buildBwrapArgs(policy), "--", file, ...args],
      env: { TMPDIR: policy.tmpDir },
    };
  }
  throw new Error(`sandbox backend unavailable: ${backend.reason ?? backend.name}`);
}

/**
 * Wrap a shell command string. The shell is the one `execShellCmd` would pick;
 * a backend exists only on macOS and Linux, where that is always POSIX `sh`.
 */
export function wrapShellInSandbox(
  command: string,
  policy: SandboxPolicy,
  backend: SandboxBackend,
  platform: NodeJS.Platform = process.platform,
): SandboxedInvocation {
  const shell = buildShellInvocation(command, platform, true);
  return wrapInSandbox(shell.cmd, shell.args, policy, backend);
}

/**
 * The read-only roots a Node toolchain needs: the directory tree holding the
 * running `node` binary and, when set, the pnpm store and nvm directory.
 * Derived from the parent's environment so a sandboxed `npm test` finds the
 * same binaries the operator's shell would.
 */
export function nodeToolchainRoots(
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): string[] {
  const roots = new Set<string>();
  // `<prefix>/bin/node` → `<prefix>`; covers nvm, Homebrew, volta and system installs alike.
  const binDir = dirname(execPath);
  roots.add(binDir.endsWith(`${sep}bin`) ? dirname(binDir) : binDir);
  for (const name of ["PNPM_HOME", "NVM_DIR", "VOLTA_HOME", "FNM_DIR", "npm_config_store_dir", "GOROOT", "GOPATH", "CARGO_HOME", "RUSTUP_HOME"]) {
    const v = env[name];
    if (v) roots.add(v);
  }
  return [...roots];
}
