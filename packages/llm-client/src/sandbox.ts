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
 *   `.rex/` because the rex MCP server it starts writes the PRD there. The
 *   repository's git control files (`.git/config`, hooks, `commondir`,
 *   `info/attributes`) are read-only to every confined process, because
 *   hench's own git runs unconfined and would run whatever program a child
 *   configured there (`core.fsmonitor`, a filter driver, `gpg.program`).
 * - **Network.** `none` for tool children — the parent makes the LLM calls,
 *   a test suite or build has no business on the network. `vendor` for the
 *   vendor CLI on macOS: TCP to port 443 on any host, the system resolver
 *   (mDNSResponder, not raw UDP 53), loopback, and Unix sockets only inside the
 *   project and scratch directories. Seatbelt cannot filter by hostname or by
 *   a loopback port range, so loopback stays open to every local TCP port.
 *   On Linux `vendor` is not restricted at all: bubblewrap can only drop the
 *   network namespace, which would cut the API, so the vendor CLI shares the
 *   host network there. `allow` is the operator's relaxation.
 * - **Backends.** Seatbelt (`sandbox-exec`) on macOS, bubblewrap (`bwrap`) on
 *   Linux. Windows has no backend yet; {@link detectSandboxBackend} says so
 *   and the caller decides whether to refuse or to run unconfined with a
 *   warning. That decision is the caller's because it depends on the run
 *   mode (an attended run may proceed; an autonomous one should not).
 *
 * The profile builders read the filesystem only to find the project's git
 * directory and layout; {@link detectSandboxBackend}'s probes and the bwrap
 * builder's path probes are injectable. Real paths are required: Seatbelt
 * matches the resolved path (`/private/tmp`, not `/tmp`), so a caller passes
 * `realpathSync` output.
 */

import { existsSync, lstatSync, readFileSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { buildShellInvocation, execFileSyncCli, isExecutableOnPath } from "./exec.js";
import { NDX_CONTAINER_DIRNAME, detectLayoutMode, resolveLayout, resolveNdxHome } from "./layout.js";
import { AUTH_TOKEN_FILENAME } from "./auth-token.js";
import { isLocalConfigTracked } from "./repo-trust.js";

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
  /**
   * Real path of ndx home. Denied whole to tool children and hooks; the vendor
   * CLI loses only the dashboard token in it, because the MCP servers it
   * starts read the user config and trust store there. Defaults to
   * `resolveNdxHome` under {@link homeDir}.
   */
  ndxHome?: string;
  /**
   * bubblewrap only: cover a masked or read-only project path that does not
   * exist yet with a read-only placeholder, so the child cannot create it
   * (Seatbelt denies an absent path without help). bwrap has to create the
   * mount point on the host, and it outlives the spawn, so a caller that
   * opts in must pass {@link SandboxedInvocation.placeholders} to
   * {@link removeSandboxPlaceholders} once the child exits — before anything
   * stages the tree (`git add -A` would commit an empty `.ndx` file).
   */
  placeholders?: boolean;
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
  ".git-credentials",
  ".cargo/credentials",
  ".cargo/credentials.toml",
  ".codex/auth.json",
  ".pypirc",
];

/**
 * Project state a confined process must not touch, in both layouts, from the
 * layout resolver rather than spelled here. A tool child is kept out of all of
 * n-dx's state; the vendor CLI may read and write the PRD (the rex MCP server
 * it starts writes there) but not hench's own configuration. In a legacy
 * project the vendor CLI may not create the `.ndx/` container either: its
 * appearance would move every later layout lookup (PRD, hench state, local
 * config) into a directory the child wrote.
 */
export function maskedProjectPathsFor(kind: SandboxSpawnKind, projectDir: string): string[] {
  const legacy = resolveLayout(projectDir, { mode: "legacy" });
  const ndx = resolveLayout(projectDir, { mode: "ndx" });
  const container = join(projectDir, NDX_CONTAINER_DIRNAME);
  if (kind === "tool") {
    return [legacy.henchDir, legacy.rexDir, container];
  }
  if (kind === "git-hook") return [];
  const paths = [join(legacy.henchDir, "config.json"), join(ndx.henchDir, "config.json")];
  if (detectLayoutMode(projectDir) === "legacy") paths.push(container);
  return paths;
}

/**
 * Project state a confined process may read but not write. A repository hook
 * run for hench's own commit reads the tree like any hook, but may not rewrite
 * hench's configuration and run records or the operator's local config (which
 * holds the sandbox setting itself), nor create the `.ndx/` container in a
 * legacy project. Every kind also gets the git control files
 * ({@link gitControlPathsFor}).
 */
export function readOnlyProjectPathsFor(kind: SandboxSpawnKind, projectDir: string): string[] {
  const git = gitControlPathsFor(projectDir).readOnly;
  if (kind !== "git-hook") return git;
  const legacy = resolveLayout(projectDir, { mode: "legacy" });
  const ndx = resolveLayout(projectDir, { mode: "ndx" });
  const paths = [legacy.henchDir, ndx.henchDir, legacy.localConfigFile, ndx.localConfigFile];
  if (detectLayoutMode(projectDir) === "legacy") paths.push(join(projectDir, NDX_CONTAINER_DIRNAME));
  return [...paths, ...git];
}

export interface GitControlPaths {
  /**
   * The git directories themselves (the project's `.git`, a linked
   * worktree's own git directory, the common directory). Pinned rather than
   * made read-only: git writes objects, refs and lock files inside them, but a
   * child that could rename one away could put a directory of its own in its
   * place, `config` and all.
   */
  dirs: string[];
  /** Files and directories git reads configuration or programs from: read-only. */
  readOnly: string[];
}

function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function isDirectoryPath(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The repository control files a confined process must not rewrite.
 *
 * Hench's lifecycle git (`git status`, staging, its own commits) runs
 * unconfined, and git runs programs its configuration names: `core.fsmonitor`,
 * `filter.<driver>.clean` for a path `.gitattributes` maps to it,
 * `gpg.program`, `core.sshCommand`, an `include.path`. A child that could
 * write `.git/config` would get a program run with the operator's full
 * permissions the next time hench runs git. So every git directory a project
 * reaches gets its `config`, `config.worktree`, `commondir` (which redirects
 * git to another common directory, config included), `hooks/` and
 * `info/attributes` read-only, and a linked worktree's `.git` file (which
 * names the git directory) as well.
 *
 * Found the way git finds them: the nearest `.git` at or above the project,
 * a `gitdir:` line when it is a file, and the `commondir` file inside that.
 * Probes are injectable for tests.
 */
export function gitControlPathsFor(
  projectDir: string,
  probes: { readText?: (p: string) => string | null; isDir?: (p: string) => boolean; real?: (p: string) => string } = {},
): GitControlPaths {
  const readText = probes.readText ?? readTextOrNull;
  const isDir = probes.isDir ?? isDirectoryPath;
  const real = probes.real ?? realOr;
  let gitDir: string | null = null;
  let gitFile: string | null = null;
  for (let dir = projectDir; ; dir = dirname(dir)) {
    const entry = join(dir, ".git");
    if (isDir(entry)) { gitDir = entry; break; }
    const text = readText(entry);
    const match = text ? /^gitdir:\s*(.+?)\s*$/m.exec(text) : null;
    if (match) { gitFile = entry; gitDir = real(resolve(dir, match[1])); break; }
    if (dirname(dir) === dir) break;
  }
  if (!gitDir) return { dirs: [], readOnly: [] };
  const commonText = readText(join(gitDir, "commondir"))?.trim();
  const common = commonText ? real(resolve(gitDir, commonText)) : gitDir;
  const dirs = [...new Set([gitDir, common])];
  const readOnly = gitFile ? [gitFile] : [];
  for (const d of dirs) {
    readOnly.push(join(d, "config"), join(d, "config.worktree"), join(d, "commondir"), join(d, "hooks"), join(d, "info", "attributes"));
  }
  return { dirs, readOnly };
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
 * write: the environment, an untracked `.n-dx.local.json`, and the user
 * config in ndx home. The tracked `.n-dx.json` and `.hench/config.json` are
 * deliberately not consulted, and neither is a `.n-dx.local.json` the
 * repository commits ({@link isLocalConfigTracked}) — whether or not the
 * checkout is trusted — so a clone can never switch confinement off.
 * Earlier sources win; an unrecognised value is ignored, not trusted.
 */
export function resolveSandboxSetting(
  projectDir: string,
  options: { env?: NodeJS.ProcessEnv; ndxHome?: string; isLocalConfigTracked?: (projectDir: string) => boolean } = {},
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
  // Only parsed sections reach the tracked check: it spawns git, and most
  // projects have no local sandbox setting to vet.
  if (local && !(options.isLocalConfigTracked ?? isLocalConfigTracked)(projectDir)) {
    take(local.mode, local.network, "local-config");
  }
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

/** True when `path` is `root` or inside it. Both separators, so a test can pass POSIX paths on any host. */
function isWithin(root: string, path: string): boolean {
  if (path === root) return true;
  // A loop, not `/[\\/]+$/`: that regex backtracks quadratically on a long run of separators.
  let end = root.length;
  while (end > 0 && (root[end - 1] === "/" || root[end - 1] === "\\")) end--;
  const trimmed = root.slice(0, end);
  return path.startsWith(`${trimmed}/`) || path.startsWith(`${trimmed}${sep}`);
}

/**
 * The caller's read-only roots, minus any that would expose the whole home
 * directory. Toolchain roots come from environment variables (`GOPATH`,
 * `CARGO_HOME`, `NVM_DIR`, …) taken verbatim, and `GOPATH=$HOME` is a common
 * setup; a root equal to or above the home would make everything there
 * readable except the named credentials — ndx home and its dashboard token
 * included. Such a root is dropped, not narrowed: the toolchain under it
 * still resolves through the system roots or a more specific variable.
 */
function readOnlyRootsFor(policy: SandboxPolicy): string[] {
  const roots = policy.readOnlyRoots ?? [];
  const home = policy.homeDir;
  return roots.filter((r) => r !== "/" && !(home && isWithin(r, home)));
}

/**
 * Credential paths denied to every confined process: the home directory's
 * credential files ({@link HOME_SECRET_DIRS}) and ndx home. The vendor CLI
 * keeps access to the macOS keychain, because that is where it stores its own
 * login (items there are protected per application by the keychain itself),
 * and to ndx home apart from the dashboard token, because the MCP servers it
 * starts read the user config and trust store there.
 */
function homeSecretPaths(policy: SandboxPolicy): string[] {
  const paths: string[] = [];
  if (policy.homeDir) {
    const dirs = policy.kind === "vendor-cli" ? HOME_SECRET_DIRS.filter((d) => d !== "Library/Keychains") : HOME_SECRET_DIRS;
    paths.push(...dirs.map((r) => resolve(policy.homeDir!, r)));
  }
  const ndxHome = policy.ndxHome ?? (policy.homeDir ? realOr(resolveNdxHome({ home: policy.homeDir })) : undefined);
  if (ndxHome) {
    // An ndx home that holds the project or the scratch directory (a test's
    // NDX_HOME, say) cannot be denied whole without denying those too.
    const holdsGrant = [policy.projectDir, policy.tmpDir, ...(policy.readWriteRoots ?? [])].some((p) => isWithin(ndxHome, p));
    paths.push(policy.kind === "vendor-cli" || holdsGrant ? join(ndxHome, AUTH_TOKEN_FILENAME) : ndxHome);
  }
  return paths;
}

/** Escape a path for an SBPL regex literal anchored at its start. */
function sbplPrefixRegex(p: string): string {
  return `(regex #"^${p.replace(/[\\^$.*+?()[\]{}|"]/g, "\\$&")}")`;
}

/**
 * Mach services every confined process may look up: directory services
 * (user and group lookups), logging, notifications, certificate trust and
 * file-system events — what Node, git and a compiler toolchain ask for. The
 * list follows the one Claude Code's own command sandbox ships with. Lookups
 * of anything else are denied, the pasteboard and window server among them.
 * LaunchServices stays reachable for type lookups, but opening an app or a
 * document through it is a separate operation (`lsopen`), and so is sending
 * an Apple Event; `(deny default)` refuses both, so `open x.command` and
 * `osascript` cannot start a process outside the sandbox.
 */
export const SANDBOX_MACH_SERVICES: readonly string[] = [
  "com.apple.audio.systemsoundserver",
  "com.apple.distributed_notifications@Uv3",
  "com.apple.FontObjectsServer",
  "com.apple.fonts",
  "com.apple.logd",
  "com.apple.lsd.mapdb",
  "com.apple.PowerManagement.control",
  "com.apple.system.logger",
  "com.apple.system.notification_center",
  "com.apple.system.opendirectoryd.libinfo",
  "com.apple.system.opendirectoryd.membership",
  "com.apple.bsd.dirhelper",
  "com.apple.securityd.xpc",
  "com.apple.coreservices.launchservicesd",
  "com.apple.trustd.agent",
  "com.apple.FSEvents",
];

/** Name resolution, for a process that has network at all. Without these a `none` child cannot exfiltrate through DNS lookups. */
export const SANDBOX_MACH_SERVICES_DNS: readonly string[] = [
  "com.apple.dnssd.service",
  "com.apple.mDNSResponder",
  "com.apple.SystemConfiguration.configd",
];

/** The vendor CLI reads its login from the keychain (`security find-generic-password`) and verifies TLS through trustd. */
export const SANDBOX_MACH_SERVICES_VENDOR: readonly string[] = [
  "com.apple.SecurityServer",
  "com.apple.secd",
  "com.apple.trustd",
];

/** The system resolver's socket; with it, the vendor profile needs no UDP 53. */
const MDNS_RESPONDER_SOCKET = "/private/var/run/mDNSResponder";

function machServicesFor(policy: SandboxPolicy): string[] {
  return [
    ...SANDBOX_MACH_SERVICES,
    ...(policy.network === "none" ? [] : SANDBOX_MACH_SERVICES_DNS),
    ...(policy.kind === "vendor-cli" ? SANDBOX_MACH_SERVICES_VENDOR : []),
  ];
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
    `(allow mach-lookup ${machServicesFor(policy).map((n) => `(global-name ${sbplString(n)})`).join(" ")})`,
    "(allow ipc-posix-shm)",
    "(allow file-read-metadata)",
    "(allow file-ioctl (literal \"/dev/null\") (literal \"/dev/tty\"))",
    "(allow file-read* file-write* (literal \"/dev/null\") (literal \"/dev/tty\") (literal \"/dev/urandom\") (literal \"/dev/random\") (literal \"/dev/zero\"))",
    "(allow file-read* (literal \"/\") (literal \"/private\") (literal \"/Users\") (literal \"/private/tmp\") (literal \"/private/var\") (literal \"/private/var/folders\"))",
    "; toolchain",
  ];
  const roRoots = [...SYSTEM_READ_ROOTS_DARWIN, ...readOnlyRootsFor(policy)];
  lines.push(`(allow file-read* ${roRoots.map((r) => `(subpath ${sbplString(r)})`).join(" ")})`);
  lines.push("; project and scratch");
  const rwRoots = [policy.projectDir, policy.tmpDir, ...(policy.readWriteRoots ?? [])];
  lines.push(`(allow file-read* file-write* ${rwRoots.map((r) => `(subpath ${sbplString(r)})`).join(" ")})`);
  if (policy.readWritePrefixes?.length) {
    lines.push(`(allow file-read* file-write* ${policy.readWritePrefixes.map(sbplPrefixRegex).join(" ")})`);
  }

  const readOnly = readOnlyProjectPathsFor(policy.kind, policy.projectDir);
  if (readOnly.length) {
    lines.push("; read-only project state and git control files");
    lines.push(`(deny file-write* ${readOnly.map((m) => `(subpath ${sbplString(m)}) (literal ${sbplString(m)})`).join(" ")})`);
  }
  const gitDirs = gitControlPathsFor(policy.projectDir).dirs;
  if (gitDirs.length) {
    // The directory entry only: git keeps writing inside it, but the child
    // cannot rename it away and put a directory of its own in its place.
    lines.push(`(deny file-write* ${gitDirs.map((d) => `(literal ${sbplString(d)})`).join(" ")})`);
  }

  lines.push("; network");
  switch (policy.network) {
    case "none":
      lines.push("(deny network*)");
      break;
    case "vendor": {
      // TLS anywhere; DNS through the system resolver's socket, never raw UDP.
      lines.push("(allow network-outbound (remote tcp \"*:443\"))");
      lines.push(`(allow network-outbound (remote unix-socket (subpath ${sbplString(MDNS_RESPONDER_SOCKET)})))`);
      // Loopback. A `(local ip …)` filter on network-outbound matches the
      // unbound source address of every connect, so it would admit all
      // egress; bind and accept take the local filter, connect the remote one.
      lines.push("(allow network-bind network-inbound (local ip \"localhost:*\"))");
      lines.push("(allow network-outbound (remote ip \"localhost:*\"))");
      // Unix sockets only where the sandbox's own processes create them; not
      // the Docker socket or the ssh-agent socket.
      const own = [policy.projectDir, policy.tmpDir].map(sbplString);
      lines.push(`(allow network-bind ${own.map((p) => `(local unix-socket (subpath ${p}))`).join(" ")})`);
      lines.push(`(allow network-outbound ${own.map((p) => `(remote unix-socket (subpath ${p}))`).join(" ")})`);
      lines.push("(allow system-socket)");
      break;
    }
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

/** What a path is on the host, for the bwrap builder: a directory, anything else, or nothing. */
export type SandboxPathKind = "dir" | "file" | null;

function hostPathKind(path: string): SandboxPathKind {
  const st = statSync(path, { throwIfNoEntry: false });
  return st ? (st.isDirectory() ? "dir" : "file") : null;
}

/** Resolver state `/etc/resolv.conf` points into on systemd-resolved and resolvconf hosts; `/run` is not otherwise mounted. */
const RESOLVER_RUN_DIRS: readonly string[] = ["/run/systemd/resolve", "/run/resolvconf"];

interface BwrapPlan {
  args: string[];
  placeholders: string[];
}

/**
 * The bwrap mount plan for a policy: the argument list, plus the placeholder
 * mount points it creates on the host when {@link SandboxPolicy.placeholders}
 * is set.
 */
function planBwrap(policy: SandboxPolicy, kindOf: (p: string) => SandboxPathKind): BwrapPlan {
  const args: string[] = ["--die-with-parent", "--new-session", "--unshare-pid"];
  for (const root of SYSTEM_READ_ROOTS_LINUX) {
    if (kindOf(root)) args.push("--ro-bind", root, root);
  }
  args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp");
  if (policy.network !== "none") {
    for (const dir of RESOLVER_RUN_DIRS) args.push("--ro-bind-try", dir, dir);
  }
  // A vendor CLI rewrites files in the home directory by temp-and-rename, so
  // it gets an empty, writable home that holds only what is bound into it
  // below; nothing it writes there outlives the spawn except the bound paths.
  if (policy.kind === "vendor-cli" && policy.homeDir) args.push("--tmpfs", policy.homeDir);
  for (const root of readOnlyRootsFor(policy)) args.push("--ro-bind-try", root, root);
  args.push("--bind", policy.projectDir, policy.projectDir);
  args.push("--bind", policy.tmpDir, policy.tmpDir);
  for (const root of policy.readWriteRoots ?? []) args.push("--bind-try", root, root);
  for (const prefix of policy.readWritePrefixes ?? []) args.push("--bind-try", prefix, prefix);

  // Only a path under a writable bind needs protecting: anything else is
  // read-only or absent in the sandbox already, and binding it would grant it.
  const writable = [policy.projectDir, policy.tmpDir, ...(policy.readWriteRoots ?? [])];
  const isWritable = (p: string) => writable.some((w) => isWithin(w, p));
  /** Strictly inside a writable root: a placeholder never replaces the root itself. */
  const isInsideWritable = (p: string) => writable.some((w) => p !== w && isWithin(w, p));

  // Pin each git directory with a bind onto itself: a mount point cannot be
  // renamed or removed, so the child cannot swap in a `.git` of its own.
  const git = gitControlPathsFor(policy.projectDir);
  for (const dir of git.dirs) {
    if (isWritable(dir) && kindOf(dir) === "dir") args.push("--bind", dir, dir);
  }

  const container = join(policy.projectDir, NDX_CONTAINER_DIRNAME);
  const ndxLayout = kindOf(container) === "dir";
  const placeholders = new Set<string>();
  // An absent path: the child could create it. With placeholders on, a
  // read-only empty file at its highest missing ancestor stops that. Paths of
  // the layout not in use are left alone while `.ndx/` exists (nothing reads
  // them), and in a legacy project every `.ndx/` path collapses onto the
  // container itself, whose appearance is what would move the layout.
  const coverAbsent = (path: string): void => {
    if (!policy.placeholders || !isInsideWritable(path)) return;
    if (ndxLayout && !isWithin(container, path)) return;
    let target = path;
    while (isInsideWritable(dirname(target)) && !kindOf(dirname(target))) target = dirname(target);
    placeholders.add(target);
  };

  // An absent git control file gets no placeholder: an unreadable
  // `config.worktree` or an empty `commondir` makes git refuse to run. So on
  // Linux a child can still create a missing `commondir`, `config.worktree`,
  // `hooks/` or `info/attributes`; Seatbelt denies those as well.
  for (const path of git.readOnly) {
    if (isWritable(path) && kindOf(path)) args.push("--ro-bind", path, path);
  }
  const gitPaths = new Set(git.readOnly);
  for (const path of readOnlyProjectPathsFor(policy.kind, policy.projectDir)) {
    if (gitPaths.has(path)) continue;
    if (kindOf(path)) args.push("--ro-bind", path, path);
    else coverAbsent(path);
  }
  for (const masked of maskedProjectPaths(policy)) {
    const kind = kindOf(masked);
    // tmpfs only mounts on a directory; a file is covered by an empty one.
    if (kind === "dir") args.push("--tmpfs", masked);
    else if (kind === "file") args.push("--ro-bind", "/dev/null", masked);
    else coverAbsent(masked);
  }
  for (const target of placeholders) args.push("--ro-bind", "/dev/null", target);
  for (const secret of homeSecretPaths(policy)) {
    const kind = kindOf(secret);
    if (kind === "dir") args.push("--tmpfs", secret);
    else if (kind === "file") args.push("--ro-bind", "/dev/null", secret);
  }
  // Only `none` can be enforced: bubblewrap either keeps the host network or
  // drops it, so `vendor` is the host network on Linux, unrestricted.
  if (policy.network === "none") args.push("--unshare-net");
  args.push("--setenv", "TMPDIR", policy.tmpDir);
  args.push("--chdir", policy.projectDir);
  return { args, placeholders: [...placeholders] };
}

/**
 * bubblewrap arguments for a policy. The root is assembled from read-only
 * binds rather than a whole-root bind so the home directory is simply
 * absent; masked project state is covered by an empty tmpfs (a directory) or
 * an empty read-only file (a file), which hides its contents and refuses
 * writes to it.
 *
 * `exists` and `isDir` probe the host; tests inject them. With only `exists`
 * given, an existing path counts as a directory unless `isDir` says otherwise.
 */
export function buildBwrapArgs(
  policy: SandboxPolicy,
  exists?: (p: string) => boolean,
  isDir?: (p: string) => boolean,
): string[] {
  return planBwrap(policy, pathKindProbe(exists, isDir)).args;
}

function pathKindProbe(exists?: (p: string) => boolean, isDir?: (p: string) => boolean): (p: string) => SandboxPathKind {
  if (!exists && !isDir) return hostPathKind;
  const ex = exists ?? existsSync;
  const dir = isDir ?? (() => true);
  return (p) => (ex(p) ? (dir(p) ? "dir" : "file") : null);
}

/**
 * Remove the placeholder mount points a bwrap spawn left on the host, once
 * the child has exited. Only an empty regular file is removed, so a path
 * that has since gained real content is kept. Safe to call more than once.
 */
export function removeSandboxPlaceholders(paths: readonly string[] | undefined): void {
  for (const path of paths ?? []) {
    try {
      const st = lstatSync(path, { throwIfNoEntry: false });
      if (st?.isFile() && st.size === 0) unlinkSync(path);
    } catch {
      // A mount still held by another sandbox, or a race: leave it.
    }
  }
}

export interface SandboxedInvocation {
  file: string;
  args: string[];
  /** Environment additions the backend needs (TMPDIR for Seatbelt; bwrap sets its own). */
  env: Record<string, string>;
  /**
   * bubblewrap with {@link SandboxPolicy.placeholders}: mount points created
   * on the host for absent protected paths. Pass to
   * {@link removeSandboxPlaceholders} when the child exits.
   */
  placeholders?: string[];
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
    const plan = planBwrap(policy, hostPathKind);
    return {
      file: "bwrap",
      args: [...plan.args, "--", file, ...args],
      env: { TMPDIR: policy.tmpDir },
      ...(plan.placeholders.length ? { placeholders: plan.placeholders } : {}),
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
