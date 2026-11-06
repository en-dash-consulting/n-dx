/**
 * The per-user credential store: `<ndx home>/credentials.json`.
 *
 * One store per user, shared by every project and worktree, for credentials
 * n-dx must hold itself (the TypeSafe key and vendor keys now; connection
 * tokens later). A stored vendor key is used only under `llm.<vendor>.auth`
 * `api` (see vendor-auth.ts). This module is the store's only reader and writer: format,
 * lock, atomic replace and owner-only permissions all live here. The
 * orchestration tier reaches it by spawning `dist/cli/credentials.js`.
 *
 * ## Lookup order
 *
 * {@link resolveCredential} reads the credential's environment variable first
 * (`TYPESAFE_API_KEY` for `typesafe`), then the store. An exported key always
 * wins, so a CI job or a one-off shell override never has to touch the file.
 * Vendor keys add `llm.<vendor>.api_key` ahead of both (`resolveVendorKey`).
 *
 * ## Backends
 *
 * - `file`: the value is in the entry.
 * - `helper`: the entry holds an argv for a password-manager command (`op`,
 *   `pass`, `bw`, `gopass`) and {@link resolveCredential} runs it, without a
 *   shell; its one line of stdout is the value, kept for the process. A
 *   failure reads as no credential, warns once per failure streak, naming the
 *   command, never its output, and is retried after
 *   {@link CREDENTIAL_HELPER_RETRY_MS}. {@link credentialStatus} reports a
 *   helper without running it.
 *
 * ## Format
 *
 * ```json
 * { "version": 1,
 *   "entries": { "typesafe": { "backend": "file", "value": "…", "updatedAt": "…" },
 *                "claude": { "backend": "helper", "argv": ["op", "read", "op://…"], "updatedAt": "…" } } }
 * ```
 *
 * Entry names are open (`connection:<id>` is reserved for connections) and
 * match {@link CREDENTIAL_NAME_PATTERN}. Unknown top-level and entry fields are
 * preserved on every write, so a newer n-dx can add fields an older one keeps.
 * A file with an unknown `version` is never overwritten and reads as empty.
 *
 * ## Safety
 *
 * - Writes go to a temp file in the same directory, then rename, under a
 *   cross-process lock (`credentials.json.lock`), so two writers lose nothing.
 * - POSIX: the file is 0600 and its directory 0700. A store readable by group
 *   or others is refused with a warning naming the fix. Windows: the writer
 *   breaks ACL inheritance and grants the owner alone (`icacls`), verified.
 * - No function here prints or logs a credential value. Status reports an
 *   8-character SHA-256 fingerprint instead.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeSync,
  type Stats,
} from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, posix } from "node:path";
import { execFileSyncCli, execFileSyncNoShell } from "./exec.js";
import { resolveNdxHome, type ResolveNdxHomeOptions } from "./layout.js";

export const CREDENTIALS_FILENAME = "credentials.json";
export const CREDENTIAL_STORE_VERSION = 1;
export const CREDENTIAL_NAME_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;

/**
 * Environment variable holding the TypeSafe API key; it overrides the store's
 * {@link TYPESAFE_CREDENTIAL} entry. Defined here rather than in config.ts so
 * config.ts can import the resolver without a cycle; config.ts re-exports it.
 */
export const TYPESAFE_API_KEY_ENV = "TYPESAFE_API_KEY";

/** The store entry holding the TypeSafe (Jev) key. */
export const TYPESAFE_CREDENTIAL = "typesafe";

/**
 * The environment variable that overrides each named credential. A name with
 * no entry here (a connection) is read from the store alone. Vendor entries
 * are named after the vendor; `llm.google.apiKeyEnv` overrides google's
 * variable through {@link CredentialStoreOptions.envVar}.
 */
export const CREDENTIAL_ENV_VARS: Readonly<Record<string, string>> = Object.freeze({
  [TYPESAFE_CREDENTIAL]: TYPESAFE_API_KEY_ENV,
  claude: "ANTHROPIC_API_KEY",
  codex: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
});

export type CredentialSource = "env" | "file" | "helper";

/** How long a credential helper may run before it counts as failed. */
export const CREDENTIAL_HELPER_TIMEOUT_MS = 10_000;

/**
 * How long a failed helper stays failed before it is run again, so a hub or
 * MCP server picks the key up once the password manager is unlocked.
 */
export const CREDENTIAL_HELPER_RETRY_MS = 60_000;

export interface ResolvedCredential {
  value: string;
  source: CredentialSource;
}

export interface CredentialStoreOptions extends ResolveNdxHomeOptions {
  /** Override the per-user directory entirely (tests). */
  ndxHome?: string;
  /** Where warnings go. Defaults to stderr. Never receives a credential value. */
  warn?: (message: string) => void;
  /** Platform whose permission rules apply. Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /**
   * The variable that overrides this credential, in place of its
   * {@link CREDENTIAL_ENV_VARS} entry (google's `llm.google.apiKeyEnv`).
   */
  envVar?: string;
  /**
   * Runs a helper entry's command; injectable for tests. Called as
   * `execFileSyncNoShell(argv[0], argv.slice(1), options)`.
   */
  helperExec?: typeof execFileSyncNoShell;
  /** False: a helper entry resolves to nothing instead of running (status without --check). */
  runHelpers?: boolean;
  /**
   * Milliseconds now, for a failed helper's retry window and an empty lock's
   * age. Defaults to `Date.now`; injectable for tests.
   */
  clock?: () => number;
}

export interface CredentialWriteOptions extends CredentialStoreOptions {
  /** How long to wait for another writer's lock, in ms. Default 10 s. */
  lockTimeoutMs?: number;
  /** Whether a lock holder's PID is running (`kill(pid, 0)`); injectable for tests. */
  pidAlive?: (pid: number) => boolean;
  /** The lock's stat, read and link calls; injectable for tests. */
  lockFs?: LockFs;
  /** Runs `icacls` on win32; injectable so the ACL path is testable anywhere. */
  execFileSyncImpl?: typeof execFileSyncCli;
  /** The current user's name for the ACL grant; injectable for tests. */
  username?: string;
}

export interface CredentialStatus {
  name: string;
  /**
   * Where {@link resolveCredential} finds the value, or null when nowhere.
   * `helper` is reported without running the helper unless `check` was set.
   */
  source: CredentialSource | null;
  /** The stored entry's backend, or null when the store has no entry. */
  backend: string | null;
  /** First 8 hex characters of the SHA-256 of the resolved value; null when not resolved. */
  fingerprint: string | null;
  /** A helper entry's command (`argv[0]`); null for any other entry. */
  helperCommand: string | null;
  /**
   * A helper's outcome: `not-run` without `check` (or with `check: "cached"`
   * before it has run), `ok` or `failed` with it.
   * Null when no helper entry is in play.
   */
  helperResult: "not-run" | "ok" | "failed" | null;
  /** The environment variable that overrides the store, when there is one. */
  envVar: string | null;
  storePath: string;
  /**
   * Why the store was not read — refused for its mode, unreadable, invalid
   * JSON or an unknown version — naming the fix. Null when it was read or is
   * absent. Never holds a value.
   */
  storeProblem: string | null;
}

interface StoreEntry {
  backend?: unknown;
  value?: unknown;
  argv?: unknown;
  updatedAt?: unknown;
  [field: string]: unknown;
}

interface StoreFile {
  version: number;
  entries: Record<string, StoreEntry>;
  [field: string]: unknown;
}

/** Where this user's store lives, whether or not it exists yet. */
export function credentialStorePath(options: CredentialStoreOptions = {}): string {
  return join(options.ndxHome ?? resolveNdxHome(options), CREDENTIALS_FILENAME);
}

/** Throws when `name` cannot be a store entry name. */
export function assertCredentialName(name: string): void {
  if (!CREDENTIAL_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid credential name ${JSON.stringify(name)}: names match ${CREDENTIAL_NAME_PATTERN.source}`,
    );
  }
}

/** First 8 hex characters of the value's SHA-256 — identifies, never reveals. */
export function credentialFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

const defaultWarn = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

// ── Reading ──────────────────────────────────────────────────────────────────

/**
 * Per-process read cache, keyed by path. A hit needs the same mtime, ctime and
 * size: a rewrite changes the first, a chmod the second, so fixing a refused
 * store's mode is seen without a restart. A cached refusal does not warn again.
 */
const readCache = new Map<string, { key: string } & StoreRead>();

/** The store's contents, or why a store that is present was not read. */
interface StoreRead {
  store: StoreFile | undefined;
  /** Names the file and the fix, never its contents; null when read or absent. */
  problem: string | null;
}

function statKey(stats: Stats): string {
  return `${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}`;
}

/** The store's contents, or undefined when it is missing, refused or unreadable. */
function readStore(path: string, options: CredentialStoreOptions): StoreFile | undefined {
  return readStoreChecked(path, options).store;
}

/**
 * {@link readStore} with the reason a present store was not read. A new
 * reason is warned once, and the warning's text is the reason.
 */
function readStoreChecked(path: string, options: CredentialStoreOptions): StoreRead {
  const warn = options.warn ?? defaultWarn;
  let stats: Stats | undefined;
  try {
    stats = statSync(path, { throwIfNoEntry: false });
  } catch (err) {
    // An ndx home this user cannot search (EACCES, e.g. left root-owned by a
    // sudo run) must not crash the caller: a key lookup is optional, and Jev
    // routing calls it on every analysis. Read as empty, warn once per cause.
    const key = `error:${errorCode(err) ?? "unknown"}`;
    const cached = readCache.get(path);
    if (cached?.key === key) return cached;
    const read: StoreRead = {
      store: undefined,
      problem: `Ignoring the credential store ${path}: it cannot be read (${errorCode(err) ?? "unknown error"}).`,
    };
    warn(read.problem!);
    readCache.set(path, { key, ...read });
    return read;
  }
  if (!stats) {
    readCache.delete(path);
    return { store: undefined, problem: null };
  }
  const key = statKey(stats);
  const cached = readCache.get(path);
  if (cached?.key === key) return cached;

  const read = loadStore(path, stats, options.platform ?? process.platform);
  if (read.problem) warn(read.problem);
  readCache.set(path, { key, ...read });
  return read;
}

function loadStore(path: string, stats: Stats, platform: NodeJS.Platform): StoreRead {
  const notRead = (problem: string): StoreRead => ({ store: undefined, problem });
  if (platform !== "win32" && (stats.mode & 0o077) !== 0) {
    return notRead(
      `Refusing to read the credential store ${path}: it is readable by other users ` +
        `(mode 0${(stats.mode & 0o777).toString(8)}). Fix it with: chmod 600 ${path}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    // The message names the file, never its contents: a JSON parse error can
    // quote the text around the fault, which may be part of a key.
    return notRead(`Ignoring the credential store ${path}: it is not valid JSON (${errorCode(err) ?? "parse error"}).`);
  }
  const versionError = checkVersion(parsed);
  if (versionError) return notRead(`Ignoring the credential store ${path}: ${versionError}`);
  return { store: parsed as StoreFile, problem: null };
}

/** Why `parsed` is not a store this version understands, or null when it is. */
function checkVersion(parsed: unknown): string | null {
  if (!isRecord(parsed)) return "it is not a JSON object.";
  if (parsed.version !== CREDENTIAL_STORE_VERSION) {
    return `version ${JSON.stringify(parsed.version)} is not one this n-dx understands (expected ${CREDENTIAL_STORE_VERSION}); upgrade n-dx.`;
  }
  if (parsed.entries !== undefined && !isRecord(parsed.entries)) return "its entries field is not an object.";
  return null;
}

/** The stored entry's value when its backend is `file` and the value is usable. */
function fileValue(entry: StoreEntry | undefined): string | undefined {
  if (!entry || entry.backend !== "file" || typeof entry.value !== "string") return undefined;
  const value = entry.value.trim();
  return value.length > 0 ? value : undefined;
}

/** The stored entry's argv when its backend is `helper` and the argv is usable. */
function helperArgv(entry: StoreEntry | undefined): string[] | undefined {
  if (!entry || entry.backend !== "helper") return undefined;
  return helperArgvError(entry.argv) === null ? (entry.argv as string[]) : undefined;
}

/**
 * Why `argv` cannot be a helper command, or null when it can. `argv[0]` is
 * also spelled into a Claude CLI deny rule (`Bash(<argv0>:*)`, comma-joined on
 * Windows), so it may not hold a comma or a parenthesis, nor start with `-`.
 */
export function helperArgvError(argv: unknown): string | null {
  if (!Array.isArray(argv) || argv.length === 0) return "a helper needs a command: a non-empty argv array.";
  if (!argv.every((a): a is string => typeof a === "string")) return "every helper argument must be a string.";
  if (argv.some((a) => /[\0\r\n]/.test(a))) return "a helper argument may not contain a line break or NUL.";
  const command = argv[0] as string;
  if (command.trim().length === 0) return "the helper command is empty.";
  if (command.startsWith("-")) return 'the helper command may not start with "-".';
  if (/[,()]/.test(command)) return "the helper command may not contain a comma or a parenthesis.";
  return null;
}

// ── Interpreter helpers ──────────────────────────────────────────────────────

/** A program token reduced to what names it: base name, no `.exe`/`.cmd`, lower case. */
function programName(token: string): string {
  return posix.basename(token.split("\\").join("/")).replace(/\.(exe|cmd|bat|com)$/i, "").toLowerCase();
}

type InterpreterFamily = "shell" | "js" | "python" | "perl" | "powershell";

const INTERPRETERS: Readonly<Record<string, InterpreterFamily>> = {
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  node: "js",
  deno: "js",
  bun: "js",
  python: "python",
  ruby: "perl",
  perl: "perl",
  pwsh: "powershell",
  powershell: "powershell",
};

function interpreterFamily(command: string): InterpreterFamily | undefined {
  const name = programName(command);
  return INTERPRETERS[name] ?? (/^python\d+(\.\d+)?$/.test(name) ? "python" : undefined);
}

/** A single-dash cluster of letters (`-c`, `-xc`, `-nE`). One pass: no backtracking on a long option. */
const OPTION_CLUSTER = /^-[A-Za-z]+$/;

/** Whether `option` runs code given on the command line rather than a script. */
function isInlineCodeOption(family: InterpreterFamily, option: string): boolean {
  switch (family) {
    // `-c`, also inside a cluster (`-xc`, `-Ic`).
    case "shell":
    case "python":
      return OPTION_CLUSTER.test(option) && option.includes("c");
    // `-e`/`-E`, also inside a cluster (`-le`, `-nE`).
    case "perl":
      return OPTION_CLUSTER.test(option) && (option.includes("e") || option.includes("E"));
    case "js":
      return /^(-e|-p|-pe|--eval|--print)(=|$)/.test(option);
    // `-Command`, `-EncodedCommand`, `-CommandWithArgs` and their abbreviations.
    case "powershell": {
      const o = option.replace(/^-+/, "").toLowerCase();
      return o.length > 0 && ["command", "encodedcommand", "commandwithargs", "ec", "cwa"].some((f) => f.startsWith(o));
    }
  }
}

/**
 * What a helper's argv runs when `argv[0]` is a known interpreter: `prefix`
 * is the argv up to and including the script (its first non-option
 * argument), or null when it has none — inline code (`bash -c`, `node -e`)
 * or no argument at all, which makes the helper a shell. Undefined when
 * `argv[0]` is not an interpreter.
 */
export function interpreterHelperPrefix(argv: readonly string[]): { interpreter: string; prefix: string[] | null } | undefined {
  const family = interpreterFamily(argv[0] ?? "");
  if (!family) return undefined;
  const interpreter = programName(argv[0]!);
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") return { interpreter, prefix: i + 1 < argv.length ? argv.slice(0, i + 2) : null };
    if (arg.startsWith("-")) {
      if (isInlineCodeOption(family, arg)) return { interpreter, prefix: null };
      continue;
    }
    // `deno run <script>` / `bun run <script>`; `deno eval` is inline code.
    if ((interpreter === "deno" || interpreter === "bun") && i === firstPositional(argv)) {
      if (arg === "eval") return { interpreter, prefix: null };
      if (arg === "run") continue;
    }
    return { interpreter, prefix: argv.slice(0, i + 1) };
  }
  return { interpreter, prefix: null };
}

function firstPositional(argv: readonly string[]): number {
  return argv.findIndex((a, i) => i > 0 && !a.startsWith("-"));
}

/**
 * Why an interpreter helper cannot be stored, or null when it can (or
 * `argv[0]` is not an interpreter). Without a script the agent could not be
 * denied the helper without being denied the interpreter. The script prefix
 * is spelled into Claude CLI deny rules, so it may not hold a comma or a
 * parenthesis either.
 */
export function interpreterHelperError(argv: readonly string[]): string | null {
  const found = interpreterHelperPrefix(argv);
  if (!found) return null;
  if (!found.prefix) {
    return (
      `${found.interpreter} with inline code or no script is a shell, not a helper; ` +
      `put the command in a script and store "${found.interpreter} <script>".`
    );
  }
  if (found.prefix.some((a) => /[,()]/.test(a))) {
    return "the interpreter's options and script may not contain a comma or a parenthesis.";
  }
  return null;
}

/**
 * Per-process helper results, keyed by entry name and argv. A success is kept
 * for the process. A failure is kept for {@link CREDENTIAL_HELPER_RETRY_MS},
 * then the helper runs again; only the first failure of a streak warns.
 */
const helperCache = new Map<string, { value: string } | { failedAt: number }>();

/** Forget every helper result. For tests: a process otherwise keeps them. */
export function clearCredentialHelperCache(): void {
  helperCache.clear();
}

/**
 * Run a helper entry's command and return its value, or undefined on failure.
 *
 * `execFileSync` with no shell ({@link execFileSyncNoShell}): `argv[0]` is the
 * program and the rest its arguments, never parsed by a shell. stdin is closed (`ignore`), so a helper
 * that would prompt fails instead of hanging the caller, and the timeout
 * bounds one that blocks anyway. Synchronous because the resolver is: Jev
 * routing and `askJev` call it inline. stdout and stderr are captured and
 * never printed — stdout is the secret, and a password manager's stderr can
 * echo it. On Windows `argv[0]` must be an executable (`op.exe`); a `.cmd`
 * shim needs a shell and fails here.
 *
 * Nothing here keeps an agent from running the helper itself: an agent
 * allowed an interpreter (`node -e`) can read the store or run the helper
 * from inside it. hench denies the helper's command by name
 * ({@link agentCredentialDenials}); only the OS keystore backends close the
 * interpreter gap.
 */
function runHelper(name: string, argv: string[], options: CredentialStoreOptions): string | undefined {
  const key = JSON.stringify([name, argv]);
  const now = (options.clock ?? Date.now)();
  const cached = helperCache.get(key);
  if (cached && "value" in cached) return cached.value;
  if (cached && now - cached.failedAt < CREDENTIAL_HELPER_RETRY_MS) return undefined;
  const run = options.helperExec ?? execFileSyncNoShell;
  let value: string | undefined;
  let failure: string | undefined;
  try {
    const stdout = run(argv[0]!, argv.slice(1), {
      // The ndx home, never the caller's cwd: on Windows a bare command name
      // is looked up in the working directory before PATH, so a checkout that
      // ships `op.exe` would otherwise be run in place of the user's `op`. A
      // relative PATH entry likewise resolves against the user's own directory.
      cwd: dirname(credentialStorePath(options)),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: CREDENTIAL_HELPER_TIMEOUT_MS,
      encoding: "utf-8",
      windowsHide: true,
      env: options.env ?? process.env,
    });
    const text = String(stdout).trim();
    if (text.length === 0) failure = "it printed nothing";
    else if (/[\r\n]/.test(text)) failure = "it printed more than one line";
    else value = text;
  } catch (err) {
    failure = helperFailure(err);
  }
  if (value !== undefined) {
    helperCache.set(key, { value });
    return value;
  }
  // A retry that fails again is the same streak: warned already.
  if (!cached) {
    (options.warn ?? defaultWarn)(
      `Credential ${name}: its helper ${JSON.stringify(argv[0])} failed (${failure}); ` +
        `continuing without it, and retrying after ${CREDENTIAL_HELPER_RETRY_MS / 1000} s.`,
    );
  }
  helperCache.set(key, { failedAt: now });
  return undefined;
}

/**
 * What this process's last run of the helper gave, without running it:
 * the value, `failed`, or undefined when it has not run.
 */
function cachedHelperResult(name: string, argv: string[]): { value: string } | "failed" | undefined {
  const cached = helperCache.get(JSON.stringify([name, argv]));
  if (!cached) return undefined;
  return "value" in cached ? { value: cached.value } : "failed";
}

/** A helper's failure as an exit code, a timeout or a launch error — never its output. */
function helperFailure(err: unknown): string {
  const e = err as (NodeJS.ErrnoException & { status?: number | null; signal?: string | null }) | null;
  if (e?.code === "ETIMEDOUT") return `timed out after ${CREDENTIAL_HELPER_TIMEOUT_MS / 1000} s`;
  if (e?.code === "ENOENT") return "command not found";
  if (typeof e?.status === "number") return `exit code ${e.status}`;
  if (e?.signal) return `killed by ${e.signal}`;
  return e?.code ? `could not start: ${e.code}` : "could not start";
}

/**
 * The credential named `name`: its environment variable when non-blank, else
 * the store's entry (a helper is run). Undefined when neither holds one.
 */
export function resolveCredential(
  name: string,
  options: CredentialStoreOptions = {},
): ResolvedCredential | undefined {
  assertCredentialName(name);
  const fromEnv = envCredential(name, options);
  if (fromEnv) return { value: fromEnv, source: "env" };
  return storedCredential(name, options);
}

function envCredential(name: string, options: CredentialStoreOptions): string | undefined {
  const envVar = options.envVar ?? CREDENTIAL_ENV_VARS[name];
  return envVar ? (options.env ?? process.env)[envVar]?.trim() || undefined : undefined;
}

/**
 * The store's entry for `name`, ignoring any environment variable: a `file`
 * value, or a helper's output (the helper is run). Undefined when the store
 * holds none or the helper fails.
 */
export function storedCredential(
  name: string,
  options: CredentialStoreOptions = {},
): ResolvedCredential | undefined {
  assertCredentialName(name);
  const entry = readStore(credentialStorePath(options), options)?.entries?.[name];
  const value = fileValue(entry);
  if (value) return { value, source: "file" };
  const argv = helperArgv(entry);
  const fromHelper = argv && options.runHelpers !== false ? runHelper(name, argv, options) : undefined;
  return fromHelper ? { value: fromHelper, source: "helper" } : undefined;
}

/**
 * Whether the store holds a usable entry for `name` — a `file` value or a
 * helper command — without running a helper.
 */
export function hasStoredCredential(name: string, options: CredentialStoreOptions = {}): boolean {
  assertCredentialName(name);
  const entry = readStore(credentialStorePath(options), options)?.entries?.[name];
  return fileValue(entry) !== undefined || helperArgv(entry) !== undefined;
}

export interface CredentialStatusOptions extends CredentialStoreOptions {
  /**
   * Run a helper entry to fingerprint its value. Off: a helper is reported,
   * not run. `cached`: report what this process's last run of it gave, and
   * `not-run` when it has not run; never runs it.
   */
  check?: boolean | "cached";
}

/** What {@link resolveCredential} would find for `name`, without the value. */
export function credentialStatus(name: string, options: CredentialStatusOptions = {}): CredentialStatus {
  assertCredentialName(name);
  const storePath = credentialStorePath(options);
  const { store, problem } = readStoreChecked(storePath, options);
  const entry = store?.entries?.[name];
  const argv = helperArgv(entry);
  const base = {
    name,
    backend: entry && typeof entry.backend === "string" ? entry.backend : null,
    helperCommand: argv ? argv[0]! : null,
    envVar: options.envVar ?? CREDENTIAL_ENV_VARS[name] ?? null,
    storePath,
    storeProblem: problem,
  };
  const fromEnv = envCredential(name, options);
  if (fromEnv) return { ...base, source: "env", fingerprint: credentialFingerprint(fromEnv), helperResult: null };
  const value = fileValue(entry);
  if (value) return { ...base, source: "file", fingerprint: credentialFingerprint(value), helperResult: null };
  if (!argv) return { ...base, source: null, fingerprint: null, helperResult: null };
  const notRun = { ...base, source: "helper", fingerprint: null, helperResult: "not-run" } as const;
  if (!options.check) return notRun;
  let fromHelper: string | undefined;
  if (options.check === "cached") {
    const cached = cachedHelperResult(name, argv);
    if (cached === undefined) return notRun;
    fromHelper = cached === "failed" ? undefined : cached.value;
  } else {
    fromHelper = runHelper(name, argv, options);
  }
  return fromHelper
    ? { ...base, source: "helper", fingerprint: credentialFingerprint(fromHelper), helperResult: "ok" }
    : { ...base, source: null, fingerprint: null, helperResult: "failed" };
}

/** Whether Jev's key resolves and from where; never the value. */
export interface JevAvailability {
  /**
   * True when the key resolved, false when it did not, null when it comes
   * from a helper that was not run, so whether it resolves is unknown.
   */
  available: boolean | null;
  /** Where the key comes from; null when unavailable (a helper that failed included). */
  source: CredentialSource | null;
}

/**
 * {@link credentialStatus} for the TypeSafe key, reduced to what a status
 * line shows. A helper runs only with `check: true`; without `check` it is
 * reported unknown, and with `check: "cached"` by what this process's last
 * run of it gave (unknown when it has not run).
 */
export function jevAvailability(options: CredentialStatusOptions = {}): JevAvailability {
  const { source, helperResult } = credentialStatus(TYPESAFE_CREDENTIAL, options);
  return { available: helperResult === "not-run" ? null : source !== null, source };
}

// ── Agent denials ────────────────────────────────────────────────────────────

/** What an agent must not reach: the store file and the commands that read a credential. */
export interface AgentCredentialDenials {
  storePath: string;
  /**
   * Command prefixes, as tokens, an agent may not run: macOS Keychain's
   * `security find-generic-password`, and every configured helper's command
   * spelled as stored, by its base name, and by that name without `.exe`.
   * For an interpreter helper (`node get-key.mjs`) the prefix runs through
   * the script, so the interpreter itself stays allowed.
   */
  commandPrefixes: string[][];
}

/** macOS Keychain's read, which a keystore backend (C10) would hold keys behind. */
const KEYCHAIN_READ = ["security", "find-generic-password"];

/**
 * The store's path and the commands an agent is denied, read from the store
 * now, without running a helper. hench's command guard and its Claude CLI
 * deny rules are built from this.
 *
 * A deny list cannot be complete: an agent allowed an interpreter (`node -e`,
 * `python -c`) can still read the store or run a helper from inside it. Only
 * the OS keystore backends (C10) close that.
 */
export function agentCredentialDenials(options: CredentialStoreOptions = {}): AgentCredentialDenials {
  const storePath = credentialStorePath(options);
  const prefixes = new Map<string, string[]>();
  const add = (tokens: string[]): void => {
    if (tokens[0]) prefixes.set(JSON.stringify(tokens), tokens);
  };
  add(KEYCHAIN_READ);
  for (const entry of Object.values(readStore(storePath, options)?.entries ?? {})) {
    const argv = helperArgv(entry);
    if (!argv) continue;
    const command = argv[0]!;
    const base = posix.basename(command.split("\\").join("/"));
    // An interpreter's script is the helper, not the interpreter: denying
    // `node` would refuse every node command to every agent run. A stored
    // interpreter helper without a usable script (refused by `set-helper`,
    // but an older store may hold one) keeps the bare interpreter denied.
    const interpreted = interpreterHelperError(argv) === null ? interpreterHelperPrefix(argv)?.prefix : undefined;
    const rest = interpreted ? interpreted.slice(1) : [];
    // `node --no-warnings get-key.mjs` is also denied without its options.
    const scriptOnly = interpreted && rest.length > 1 ? [rest[rest.length - 1]!] : undefined;
    for (const spelling of [command, base, base.replace(/\.(exe|cmd|bat|com)$/i, "")]) {
      add([spelling, ...rest]);
      if (scriptOnly) add([spelling, ...scriptOnly]);
    }
  }
  return { storePath, commandPrefixes: [...prefixes.values()] };
}

// ── Writing ──────────────────────────────────────────────────────────────────

/** Store `value` under `name` with the `file` backend. */
export function setCredential(name: string, value: string, options: CredentialWriteOptions = {}): void {
  assertCredentialName(name);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`Refusing to store an empty value for ${name}.`);
  if (/[\r\n]/.test(trimmed)) throw new Error(`Refusing to store a multi-line value for ${name}.`);
  updateStore(options, (store) => {
    // Spread first: fields a newer n-dx added to the entry survive. The
    // helper backend's argv does not: switching backends drops it.
    const { argv: _helperArgv, ...kept } = store.entries[name] ?? {};
    store.entries[name] = {
      ...kept,
      backend: "file",
      value: trimmed,
      updatedAt: new Date().toISOString(),
    };
    return true;
  });
}

/**
 * Store `name` with the `helper` backend: `argv` is run, without a shell,
 * whenever the value is needed. Nothing is run here.
 */
export function setHelperCredential(name: string, argv: readonly string[], options: CredentialWriteOptions = {}): void {
  assertCredentialName(name);
  const argvError = helperArgvError(argv) ?? interpreterHelperError(argv);
  if (argvError) throw new Error(`Refusing to store a helper for ${name}: ${argvError}`);
  updateStore(options, (store) => {
    // As in setCredential: unknown fields survive, the file backend's value does not.
    const { value: _fileValue, ...kept } = store.entries[name] ?? {};
    store.entries[name] = {
      ...kept,
      backend: "helper",
      argv: [...argv],
      updatedAt: new Date().toISOString(),
    };
    return true;
  });
}

/** Remove `name` from the store. Returns whether an entry was removed. */
export function unsetCredential(name: string, options: CredentialWriteOptions = {}): boolean {
  assertCredentialName(name);
  let removed = false;
  updateStore(options, (store) => {
    if (!Object.hasOwn(store.entries, name)) return false;
    delete store.entries[name];
    removed = true;
    return true;
  });
  return removed;
}

/**
 * Read-modify-write the store under its lock. `mutate` returns false when it
 * changed nothing, and then nothing is written.
 */
function updateStore(options: CredentialWriteOptions, mutate: (store: StoreFile) => boolean): void {
  const path = credentialStorePath(options);
  const dir = dirname(path);
  const platform = options.platform ?? process.platform;
  ensurePrivateDir(dir, platform);

  const seams: LockSeams = {
    now: options.clock ?? defaultLockSeams.now,
    pidAlive: options.pidAlive ?? defaultLockSeams.pidAlive,
    platform,
    fs: options.lockFs,
  };
  withStoreLock(path, options.lockTimeoutMs ?? 10_000, seams, () => {
    const store = readStoreForWrite(path);
    if (!mutate(store)) return;
    const exposedMode = platform === "win32" ? 0 : (statSync(path, { throwIfNoEntry: false })?.mode ?? 0) & 0o777;
    writeStoreAtomic(path, store, options);
    if (exposedMode & 0o077) {
      (options.warn ?? defaultWarn)(
        `The credential store ${path} was readable by other users (mode 0${exposedMode.toString(8)}); ` +
          `it is now 0600. Rotate any key it held before this write.`,
      );
    }
  });
  readCache.delete(path);
}

function ensurePrivateDir(dir: string, platform: NodeJS.Platform): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (platform === "win32") return;
  // An ndx home created by an older n-dx, or by hand, may be 0755. The store
  // is the reason the directory must be private, so it is tightened here.
  if ((statSync(dir).mode & 0o077) !== 0) chmodSync(dir, 0o700);
}

/**
 * The store as it is on disk right now (never the cache: a writer must see
 * the previous writer's update). A missing file is an empty store; an unknown
 * version or unparseable file throws, so it is never overwritten.
 */
function readStoreForWrite(path: string): StoreFile {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    if (errorCode(err) === "ENOENT") return { version: CREDENTIAL_STORE_VERSION, entries: {} };
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`The credential store ${path} is not valid JSON; fix or remove it before storing a credential.`);
  }
  const versionError = checkVersion(parsed);
  if (versionError) throw new Error(`Refusing to overwrite the credential store ${path}: ${versionError}`);
  const store = parsed as StoreFile;
  return { ...store, entries: { ...(store.entries ?? {}) } };
}

function writeStoreAtomic(path: string, store: StoreFile, options: CredentialWriteOptions): void {
  const platform = options.platform ?? process.platform;
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeSync(fd, `${JSON.stringify(store, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
  try {
    if (platform === "win32") {
      // Restrict before the rename, so the store is never in place unrestricted.
      const result = restrictToOwnerWindows(temporary, {
        execFileSyncImpl: options.execFileSyncImpl ?? execFileSyncCli,
        username: options.username,
        env: options.env,
      });
      if (!result.restricted) {
        (options.warn ?? defaultWarn)(
          `Warning: could not restrict permissions on ${path}: ${result.detail}. ` +
            `It may be readable by other users of this machine.`,
        );
      }
    } else {
      // The process umask can only remove bits from 0600, but be explicit.
      chmodSync(temporary, 0o600);
    }
    renameSync(temporary, path);
  } catch (err) {
    rmSync(temporary, { force: true });
    throw err;
  }
}

// ── Windows owner-only ACL ───────────────────────────────────────────────────

export interface AclResult {
  restricted: boolean;
  detail: string;
}

/**
 * Parse `icacls <path>` output into access-control entries. Identities and
 * flags are symbolic and not localized, so this is locale-safe.
 *
 * TWIN: packages/core/file-permissions.js parseIcaclsOutput.
 */
export function parseIcaclsOutput(output: string, path: string): Array<{ identity: string; flags: string[] }> {
  const aces: Array<{ identity: string; flags: string[] }> = [];
  for (const rawLine of String(output).split(/\r?\n/)) {
    const line = rawLine.replace(path, "").trim();
    if (!line) continue;
    // Flag groups exclude "(" so the match stays linear on pathological lines.
    const match = line.match(/^(.*?):((?:\([^()]*\))+)$/);
    if (!match) continue;
    const identity = match[1].trim();
    if (!identity) continue;
    aces.push({ identity, flags: [...match[2].matchAll(/\(([^()]*)\)/g)].map((m) => m[1]) });
  }
  return aces;
}

function sameIdentity(a: string, b: string): boolean {
  const bare = (s: string): string => s.toLowerCase().split("\\").pop()!.trim();
  return bare(a) === bare(b);
}

/**
 * Break inheritance on `path` and grant the current user alone, then verify
 * the DACL rather than trusting icacls's exit code. Never throws.
 *
 * Ported from packages/core/file-permissions.js restrictFileToOwner (its win32
 * branch); `fs.chmod` on Windows changes only the read-only attribute and
 * leaves every inherited ACE in place.
 */
export function restrictToOwnerWindows(
  path: string,
  options: { execFileSyncImpl?: typeof execFileSyncCli; username?: string; env?: NodeJS.ProcessEnv } = {},
): AclResult {
  const run = options.execFileSyncImpl ?? execFileSyncCli;
  let username: string;
  try {
    username = options.username ?? userInfo().username;
  } catch (err) {
    return { restricted: false, detail: `could not determine the current user: ${errorMessage(err)}` };
  }
  // Fully qualified when the domain is known: a bare name can be ambiguous.
  const domain = (options.env ?? process.env).USERDOMAIN;
  const grantee = domain ? `${domain}\\${username}` : username;

  try {
    run("icacls", [path, "/inheritance:r", "/grant:r", `${grantee}:F`], { stdio: "ignore" });
  } catch (err) {
    return { restricted: false, detail: `icacls failed: ${errorMessage(err)}` };
  }

  let aces: Array<{ identity: string; flags: string[] }>;
  try {
    aces = parseIcaclsOutput(String(run("icacls", [path], { encoding: "utf-8" })), path);
  } catch (err) {
    return { restricted: false, detail: `could not read back the ACL: ${errorMessage(err)}` };
  }

  // Inheritance removal leaves other principals' EXPLICIT ACEs (some temp
  // directories start files with them); remove each, then re-verify.
  const leftover = [...new Set(
    aces.filter((a) => !a.flags.includes("I") && !sameIdentity(a.identity, username)).map((a) => a.identity),
  )];
  if (leftover.length > 0) {
    try {
      run("icacls", [path, ...leftover.flatMap((identity) => ["/remove", identity])], { stdio: "ignore" });
      aces = parseIcaclsOutput(String(run("icacls", [path], { encoding: "utf-8" })), path);
    } catch (err) {
      return { restricted: false, detail: `icacls failed removing ${leftover.join(", ")}: ${errorMessage(err)}` };
    }
  }

  if (aces.length === 0) return { restricted: false, detail: "could not parse the ACL from icacls output" };
  const inherited = aces.filter((a) => a.flags.includes("I"));
  if (inherited.length > 0) {
    return { restricted: false, detail: `inheritance is still in effect (${inherited.map((a) => a.identity).join(", ")})` };
  }
  const foreign = aces.filter((a) => !sameIdentity(a.identity, username));
  if (foreign.length > 0) {
    return { restricted: false, detail: `other principals still have access: ${foreign.map((a) => a.identity).join(", ")}` };
  }
  return { restricted: true, detail: `DACL restricted to ${grantee}` };
}

// ── Cross-process lock ───────────────────────────────────────────────────────

const LOCK_POLL_MS = 25;
/**
 * An empty lock this old was left by an n-dx from before locks were linked
 * into place filled, whose writer died between creating and writing it. A
 * lock this version creates is never empty, so the rule never reaches one.
 */
export const EMPTY_LOCK_STALE_MS = 5_000;

/** The filesystem calls the lock observes and publishes with. */
export interface LockFs {
  stat: (path: string) => Stats;
  readFile: (path: string) => string;
  link: (existingPath: string, newPath: string) => void;
  /** Remove a file; a missing one is not an error. */
  rm: (path: string) => void;
}

const nodeLockFs: LockFs = {
  stat: (path) => statSync(path),
  readFile: (path) => readFileSync(path, "utf-8"),
  link: (existingPath, newPath) => linkSync(existingPath, newPath),
  rm: (path) => rmSync(path, { force: true }),
};

/** What the lock consults about the outside world; injectable for tests. */
export interface LockSeams {
  /** Milliseconds now, for an empty lock's age. */
  now: () => number;
  /** Whether a holder's PID is still running. */
  pidAlive: (pid: number) => boolean;
  /** Whose filesystem rules apply. Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Defaults to node:fs. */
  fs?: LockFs;
}

const defaultLockSeams: LockSeams = { now: () => Date.now(), pidAlive: (pid) => pidAlive(pid) };

/**
 * Codes Windows returns for a lock file another process is deleting: opening,
 * statting or linking to a delete-pending name fails with these, not ENOENT
 * or EEXIST. A real permission problem gives the same codes; it persists, so
 * it still ends in the lock's timeout, which carries it as the cause.
 */
const WINDOWS_CONTENTION_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

function isContention(err: unknown, seams: LockSeams): boolean {
  return (seams.platform ?? process.platform) === "win32" && WINDOWS_CONTENTION_CODES.has(errorCode(err) ?? "");
}

/**
 * Run `fn` holding `<store>.lock`. The lock file records the holder's PID and
 * is created already filled, so it is never seen empty. A lock whose PID is
 * dead, or an empty one an older n-dx left past {@link EMPTY_LOCK_STALE_MS},
 * is taken over. A live holder is waited for up to `timeoutMs` however old
 * its lock, then the call fails naming it. On Windows, a lock-family call
 * that fails because another writer is deleting the file counts as contended
 * and is retried within the same budget; only a successful publication enters.
 */
function withStoreLock<T>(storePath: string, timeoutMs: number, seams: LockSeams, fn: () => T): T {
  const lockPath = `${storePath}.lock`;
  const content = holderContent();
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    let holder: LockState | undefined;
    let contention: unknown;
    try {
      if (createFilled(lockPath, content, seams)) break;
      holder = inspectLock(lockPath, seams);
      if (holder !== undefined && lockIsStale(holder, seams) && takeOverStaleLock(lockPath, holder, seams)) continue;
    } catch (err) {
      if (!isContention(err, seams)) throw err;
      contention = err;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for the credential store lock ${lockPath}` +
          (holder?.pid !== undefined ? ` (held by PID ${holder.pid} since ${holder.since}).` : ".") +
          ` If no n-dx process is running, delete ${lockPath}.` +
          (contention === undefined ? "" : ` Last error: ${errorMessage(contention)}`),
        contention === undefined ? undefined : { cause: contention },
      );
    }
    sleepSync(LOCK_POLL_MS);
  }

  try {
    return fn();
  } finally {
    releaseLock(lockPath, content, seams, timeoutMs);
    sweepStrandedTemps(seams.fs ?? nodeLockFs);
  }
}

/**
 * Remove only our own lock. Nobody else removes a live lock, so it is still
 * ours when its content is. Windows contention is retried for up to
 * `budgetMs`, so a reader racing the release cannot fail a write that landed.
 */
function releaseLock(lockPath: string, content: string, seams: LockSeams, budgetMs: number): void {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      removeIfOwn(lockPath, content, seams);
      return;
    } catch (err) {
      if (!isContention(err, seams) || Date.now() >= deadline) throw err;
    }
    sleepSync(LOCK_POLL_MS);
  }
}

function holderContent(): string {
  return JSON.stringify({ pid: process.pid, token: randomUUID(), since: new Date().toISOString() });
}

/** linkSync codes that mean the volume has no hard links (exFAT, FAT, smbfs). */
const UNSUPPORTED_LINK_CODES = new Set(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM", "EXDEV"]);
/** The holder file inside a lock or guard published as a directory. */
const LOCK_OWNER_FILE = "owner.json";

/**
 * Create `path` holding `content`, or return false when it exists. The
 * content goes to a private temp file first and is hard-linked into place, so
 * the file appears complete or not at all, and the link's EEXIST is the same
 * exclusive test `open(..., "wx")` gives.
 *
 * Where the volume has no hard links, `mkdir(path)` is the exclusive test and
 * the filled temp file is renamed to `<path>/owner.json`. The directory is
 * visible owner-less for a moment; {@link lockIsStale} never judges an
 * owner-less directory stale, so that moment cannot cost its writer the lock.
 *
 * On Windows, linking onto a name another process is deleting also fails
 * with EPERM. A link to a fresh name settles which it was: when that link
 * works the volume has hard links, so `path` is occupied and this returns
 * false; when it fails too the volume has none and mkdir takes over.
 *
 * Nothing after a publication can throw: a temp file that will not go is
 * left to {@link sweepStrandedTemps}, so a published lock always returns true
 * and is released by its writer.
 */
export function createFilled(path: string, content: string, seams: LockSeams = defaultLockSeams): boolean {
  const fs = seams.fs ?? nodeLockFs;
  sweepStrandedTemps(fs);
  const tmp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  let tmpMoved = false;
  try {
    try {
      writeSync(fd, content);
    } finally {
      closeSync(fd);
    }
    try {
      fs.link(tmp, path);
      return true;
    } catch (err) {
      if (errorCode(err) === "EEXIST") return false;
      if (!UNSUPPORTED_LINK_CODES.has(errorCode(err) ?? "")) throw err;
      if (isContention(err, seams) && hardLinksWork(tmp, fs)) return false;
    }
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (err) {
      if (errorCode(err) === "EEXIST") return false;
      throw err;
    }
    try {
      renameSync(tmp, join(path, LOCK_OWNER_FILE));
      tmpMoved = true;
    } catch (err) {
      rmdirSync(path);
      throw err;
    }
    return true;
  } finally {
    if (!tmpMoved) discardTemp(tmp, fs);
  }
}

/**
 * Temp files whose removal failed, retried on every later lock call and after
 * each release. Windows refuses to delete a file a scanner or the indexer has
 * just opened. Its removal decides nothing, so its failure must not turn a
 * published lock into an error: the writer would lose its update and its own
 * live PID would hold the lock until it exits. A temp file that outlives the
 * process is private and inert.
 */
const strandedTemps = new Set<string>();

function discardTemp(tmp: string, fs: LockFs): void {
  try {
    fs.rm(tmp);
  } catch {
    strandedTemps.add(tmp);
  }
}

function sweepStrandedTemps(fs: LockFs): void {
  for (const tmp of [...strandedTemps]) {
    strandedTemps.delete(tmp);
    discardTemp(tmp, fs);
  }
}

/** Whether `tmp` can be hard-linked to a name nobody else uses. */
function hardLinksWork(tmp: string, fs: LockFs): boolean {
  const probe = `${tmp}.probe`;
  try {
    fs.link(tmp, probe);
  } catch {
    return false;
  }
  discardTemp(probe, fs);
  return true;
}

/** Remove a lock or guard only while it still holds our content. */
function removeIfOwn(path: string, content: string, seams: LockSeams): void {
  if (inspectLock(path, seams)?.raw === content) removeLock(path, seams);
}

/**
 * Remove a lock or guard of either form. A directory loses its owner file
 * first; until the directory itself goes it reads as owner-less, so as held.
 */
function removeLock(path: string, seams: LockSeams): void {
  if (!statIfPresent(path, seams.fs ?? nodeLockFs)?.isDirectory()) {
    rmSync(path, { force: true });
    return;
  }
  rmSync(join(path, LOCK_OWNER_FILE), { force: true });
  try {
    rmdirSync(path);
  } catch (err) {
    if (errorCode(err) !== "ENOENT") throw err;
  }
}

/** One observation of the lock file. */
export interface LockState {
  /** A file, or a directory holding owner.json where hard links are absent. */
  form: "file" | "directory";
  /**
   * The holder's record; empty for a lock an older n-dx created, or for a
   * directory whose owner file is not renamed in yet.
   */
  raw: string;
  /** Inode, mtime and content: a replaced lock never matches the old one. */
  identity: string;
  /** The holder's PID, absent when the content is unreadable. */
  pid?: number;
  since?: string;
  ageMs: number;
}

function statIfPresent(path: string, fs: LockFs): Stats | undefined {
  try {
    return fs.stat(path);
  } catch (err) {
    if (errorCode(err) === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * The lock (or guard) as it is now, or undefined when there is none. A file
 * Windows is deleting throws (EPERM/EBUSY) rather than reading as absent:
 * the caller retries, and nothing mistakes a lock it could not read for gone.
 */
export function inspectLock(lockPath: string, seams: LockSeams = defaultLockSeams): LockState | undefined {
  const fs = seams.fs ?? nodeLockFs;
  const now = seams.now();
  let stats: Stats;
  let raw: string;
  let form: LockState["form"] = "file";
  try {
    stats = fs.stat(lockPath);
    if (stats.isDirectory()) {
      form = "directory";
      const owner = readOwnerFile(join(lockPath, LOCK_OWNER_FILE), fs);
      if (owner === undefined) {
        return { form, raw: "", identity: `dir:${stats.ino}:${stats.mtimeMs}:`, ageMs: now - stats.mtimeMs };
      }
      [stats, raw] = owner;
    } else {
      raw = fs.readFile(lockPath);
    }
  } catch (err) {
    if (errorCode(err) === "ENOENT") return undefined;
    throw err;
  }
  const state: LockState = {
    form,
    raw,
    identity: `${form === "directory" ? "dir:" : ""}${stats.ino}:${stats.mtimeMs}:${raw}`,
    ageMs: now - stats.mtimeMs,
  };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.pid === "number") {
      state.pid = parsed.pid;
      state.since = String(parsed.since ?? "unknown");
    }
  } catch (err) {
    // An older n-dx's lock, created empty and not yet (or never) written.
    if (!(err instanceof SyntaxError)) throw err;
  }
  return state;
}

/** A directory lock's owner file and its stats, or undefined while it is not renamed in. */
function readOwnerFile(path: string, fs: LockFs): [Stats, string] | undefined {
  try {
    return [fs.stat(path), fs.readFile(path)];
  } catch (err) {
    if (errorCode(err) === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * A dead holder's lock, or an older n-dx's unreadable lock file past the
 * threshold. A filled lock with a live PID is never stale however old: a
 * paused writer (sleep, SIGSTOP, swap) or a lagging clock on a network home
 * must not cost a live lock. Nor is a directory without a readable holder:
 * its writer may be paused between mkdir and renaming the owner in, and an
 * age rule there would reopen the empty-lock window. Deleting it by hand, as
 * the timeout message says, is the way out.
 */
export function lockIsStale(lock: LockState, seams: LockSeams = defaultLockSeams): boolean {
  if (lock.pid !== undefined) return !seams.pidAlive(lock.pid);
  return lock.form === "file" && lock.ageMs >= EMPTY_LOCK_STALE_MS;
}

/** The guard every writer that judged this lock stale contends for. */
export function takeoverGuardPath(lockPath: string, judged: LockState): string {
  return `${lockPath}.${createHash("sha256").update(judged.identity).digest("hex").slice(0, 16)}.takeover`;
}

/**
 * Remove a stale lock, but only the one judged stale. Writers that judged the
 * same lock contend for one exclusive guard file, created filled with the
 * holder's PID; the winner re-inspects and removes the lock only when it is
 * unchanged and still stale. Nobody else removes a stale lock and nobody can
 * create one while it exists, so the removal never hits a live lock a faster
 * writer took meanwhile. Returns true when the lock is gone and the caller may
 * retry at once.
 */
export function takeOverStaleLock(lockPath: string, judged: LockState, seams: LockSeams = defaultLockSeams): boolean {
  const guard = takeoverGuardPath(lockPath, judged);
  const content = holderContent();
  if (!createFilled(guard, content, seams)) {
    reclaimAbandonedGuard(guard, seams);
    return false;
  }
  try {
    const current = inspectLock(lockPath, seams);
    if (current === undefined) return true;
    if (current.identity !== judged.identity || !lockIsStale(current, seams)) return false;
    removeLock(lockPath, seams);
    return true;
  } finally {
    removeIfOwn(guard, content, seams);
  }
}

/**
 * Drop a guard whose recorded holder is dead; a live holder's guard stays
 * however old. A guard with no readable PID (an older n-dx created it empty)
 * is left too: it blocks takeover of only the lock it names, and deleting
 * that lock, as the timeout message says, frees it. Two writers reclaiming
 * the same dead holder's guard at once can still both enter; that needs a
 * writer killed inside the guard, and this keeps it recoverable.
 */
function reclaimAbandonedGuard(guard: string, seams: LockSeams): void {
  const state = inspectLock(guard, seams);
  if (state?.pid !== undefined && !seams.pidAlive(state.pid)) removeLock(guard, seams);
}

/** `kill(pid, 0)`; EPERM means the process exists but is not ours to signal. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errorCode(err) === "EPERM";
  }
}

const sleepCell = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms: number): void {
  Atomics.wait(sleepCell, 0, 0, ms);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
