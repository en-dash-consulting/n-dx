/**
 * Where the host-wide validation slot lives:
 * `<ndx home>/validation-slot/<host>/`.
 *
 * The host subdirectory keeps the slot per host when several hosts share one
 * ndx home (a network home directory): a holder's liveness is judged by pid
 * and boot time, which mean nothing on another host, so a shared directory
 * would let each host reclaim the other's live record.
 *
 * `<host>` is keyed on the machine id, not the hostname: on macOS without a
 * fixed HostName, `os.hostname()` follows DHCP or reverse DNS, so a run
 * started after a network change would find a different, free directory and
 * run beside the holder. The id is hashed, so no raw machine id lands on disk.
 *
 * A process handed an absolute `NDX_VALIDATION_SLOT_DIR` uses that directory
 * and runs no lookup (rule 6 in `validation-slot.ts`): hench resolves the
 * directory on the host and passes it to every command it confines, where
 * the lookup may be refused or slow, and a slot holder passes it to its
 * validation command.
 *
 * A lookup ends one of three ways, and only the first two are cached for the
 * life of the process:
 * - **found**: the machine id was read; the directory is `m-<hash>`.
 * - **no source**: the platform has none, the files are absent (ENOENT), or
 *   the command answered without an id; the directory is `h-<hash>` of the
 *   hostname, the answer every process on this host gets.
 * - **transient**: a timeout, an error other than ENOENT, or a non-zero exit
 *   with no id. This rejects with `HostIdentityLookupError` and never falls
 *   back to the hostname, because every other process on the host read the id
 *   and uses `m-<hash>`. The caller runs that one validation without the slot
 *   and warns. The failure is remembered for 60 s: a call within that window
 *   rejects at once without running the lookup, and the first call after it
 *   retries. A lookup that keeps failing costs one timeout a minute, not one
 *   per validation or per sandboxed command.
 *
 * The lookup command may run for 10 s: on a loaded host (swapping, exactly
 * when the slot matters) `ioreg` or `reg` can take seconds to start, and a
 * lookup that succeeds runs once per process, so a long limit costs nothing.
 *
 * Kept apart from `validation-slot.ts` so the protocol module imports only
 * `node:` builtins; the ndx home's lookup order is llm-client's, reached
 * through the gateway, and the platform lookups run through `exec.ts`.
 *
 * @module hench/process/validation-slot-dir
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { resolveNdxHome } from "../prd/llm-gateway.js";
import { exec } from "./exec.js";
import { VALIDATION_SLOT_DIR_ENV, VALIDATION_SLOT_DIRNAME } from "./validation-slot.js";

/** What names this host: a stable machine id, or the hostname when the host has none. */
export interface HostIdentity {
  kind: "machine" | "hostname";
  id: string;
}

/**
 * How a lookup command ended: it exited (any code) with `stdout`, its binary
 * does not exist, or it failed another way (timeout, kill, spawn error).
 */
export type LookupRun =
  | { kind: "exited"; exitCode: number; stdout: string }
  | { kind: "missing" }
  | { kind: "failed"; reason: string };

/** The platform lookups `readHostIdentity` uses; injectable for tests. */
export interface HostIdentitySources {
  platform: NodeJS.Platform;
  /** A file's contents; rejects with the fs error (and its `code`) when it cannot be read. */
  readFile(path: string): Promise<string>;
  /** Run a command without a shell. */
  run(file: string, args: string[]): Promise<LookupRun>;
  hostname(): string;
}

/** A machine-id lookup that failed in a way that may not recur. Remembered for 60 s; never the hostname. */
export class HostIdentityLookupError extends Error {
  constructor(lookup: string, reason: string) {
    super(`could not read this host's machine id (${lookup}: ${reason}); it is read again after 60 s`);
    this.name = "HostIdentityLookupError";
  }
}

/** Linux machine-id files, in lookup order. */
export const LINUX_MACHINE_ID_FILES = ["/etc/machine-id", "/var/lib/dbus/machine-id"] as const;

/** How long a platform lookup command may run; see the module header. */
export const LOOKUP_TIMEOUT_MS = 10_000;

/** How long a transient lookup failure is remembered before the lookup runs again. */
export const LOOKUP_RETRY_AFTER_MS = 60_000;

/** Run a lookup command through `exec` and say how it ended; the default `HostIdentitySources.run`. */
export async function runLookup(file: string, args: string[], timeoutMs = LOOKUP_TIMEOUT_MS): Promise<LookupRun> {
  const result = await exec(file, args, { cwd: tmpdir(), timeout: timeoutMs });
  if (result.launched && result.exitCode !== null) {
    return { kind: "exited", exitCode: result.exitCode, stdout: result.stdout };
  }
  if (!result.launched && errorCode(result.error) === "ENOENT") return { kind: "missing" };
  return { kind: "failed", reason: result.error?.message ?? "ended without an exit code" };
}

const DEFAULT_SOURCES: HostIdentitySources = {
  platform: process.platform,
  readFile: (path) => readFile(path, "utf-8"),
  run: (file, args) => runLookup(file, args),
  hostname,
};

/** One lookup's result: an id, no id on this host, or a failure to retry. */
type MachineIdOutcome =
  | { kind: "found"; id: string }
  | { kind: "none" }
  | { kind: "transient"; lookup: string; reason: string };

const NONE: MachineIdOutcome = { kind: "none" };

function errorCode(err: unknown): unknown {
  return err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
}

async function readMachineIdFile(sources: HostIdentitySources, path: string): Promise<MachineIdOutcome> {
  let id: string;
  try {
    id = (await sources.readFile(path)).trim();
  } catch (err) {
    const code = errorCode(err);
    if (code === "ENOENT" || code === "ENOTDIR") return NONE;
    return { kind: "transient", lookup: `reading ${path}`, reason: err instanceof Error ? err.message : String(err) };
  }
  // An unset id ("" or "uninitialized" during first boot) is not one.
  return /^[0-9a-f]{32}$/i.test(id) ? { kind: "found", id } : NONE;
}

async function linuxMachineId(sources: HostIdentitySources): Promise<MachineIdOutcome> {
  let transient: MachineIdOutcome | undefined;
  for (const path of LINUX_MACHINE_ID_FILES) {
    const outcome = await readMachineIdFile(sources, path);
    if (outcome.kind === "found") return outcome;
    if (outcome.kind === "transient") transient ??= outcome;
  }
  return transient ?? NONE;
}

async function commandMatch(
  sources: HostIdentitySources,
  file: string,
  args: string[],
  pattern: RegExp,
): Promise<MachineIdOutcome> {
  const lookup = `running ${[file, ...args].join(" ")}`;
  const run = await sources.run(file, args);
  if (run.kind === "missing") return NONE;
  if (run.kind === "failed") return { kind: "transient", lookup, reason: run.reason };
  const id = pattern.exec(run.stdout)?.[1]?.trim();
  if (id) return { kind: "found", id };
  return run.exitCode === 0 ? NONE : { kind: "transient", lookup, reason: `exited with code ${run.exitCode}` };
}

function machineId(sources: HostIdentitySources): Promise<MachineIdOutcome> {
  switch (sources.platform) {
    case "linux":
      return linuxMachineId(sources);
    case "darwin":
      return commandMatch(
        sources,
        "ioreg",
        ["-rd1", "-c", "IOPlatformExpertDevice"],
        /"IOPlatformUUID"\s*=\s*"([^"]+)"/,
      );
    case "win32":
      return commandMatch(
        sources,
        "reg",
        ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
        /MachineGuid\s+REG_SZ\s+(\S+)/i,
      );
    default:
      return Promise.resolve(NONE);
  }
}

/**
 * This host's identity, read now: its machine id, else its hostname when the
 * host has none. Rejects with `HostIdentityLookupError` on a transient failure.
 */
export async function readHostIdentity(sources: HostIdentitySources = DEFAULT_SOURCES): Promise<HostIdentity> {
  const outcome = await machineId(sources);
  switch (outcome.kind) {
    case "found":
      return { kind: "machine", id: outcome.id };
    case "none":
      return { kind: "hostname", id: sources.hostname() };
    case "transient":
      throw new HostIdentityLookupError(outcome.lookup, outcome.reason);
  }
}

/** This host's identity, read once and kept; see `createHostIdentityCache`. */
export interface HostIdentityCache {
  /**
   * The identity. Within 60 s of a transient failure, rejects with that
   * failure at once, without running the lookup again.
   */
  (): Promise<HostIdentity>;
  /**
   * The identity if a lookup has already resolved, without waiting.
   * Otherwise starts one (unless one is running or a failure is remembered)
   * and returns undefined.
   */
  peek(): HostIdentity | undefined;
}

/**
 * `readHostIdentity(sources)`, kept once it resolves. A rejected lookup is
 * remembered for `retryAfterMs` (default 60 s), then retried.
 */
export function createHostIdentityCache(
  sources: HostIdentitySources,
  options: { now?: () => number; retryAfterMs?: number } = {},
): HostIdentityCache {
  const now = options.now ?? Date.now;
  const retryAfterMs = options.retryAfterMs ?? LOOKUP_RETRY_AFTER_MS;
  let cached: Promise<HostIdentity> | undefined;
  let resolved: HostIdentity | undefined;
  let failure: { error: unknown; until: number } | undefined;
  const failureRemembered = (): boolean => failure !== undefined && now() < failure.until;

  const lookup = (): Promise<HostIdentity> => {
    if (cached) return cached;
    if (failure && failureRemembered()) return Promise.reject(failure.error);
    failure = undefined;
    const attempt = readHostIdentity(sources);
    cached = attempt;
    // The caller sees a rejection through `attempt`; this records the outcome.
    attempt.then(
      (identity) => {
        resolved = identity;
      },
      (error: unknown) => {
        cached = undefined;
        failure = { error, until: now() + retryAfterMs };
      },
    );
    return attempt;
  };

  const peek = (): HostIdentity | undefined => {
    // `lookup()` has attached its own handler, so a failure is recorded, not unhandled.
    if (!resolved && !cached && !failureRemembered()) void lookup();
    return resolved;
  };

  return Object.assign(lookup, { peek });
}

/** This host's identity, read once per process; a transient failure is retried after 60 s. */
export const hostIdentity: HostIdentityCache = createHostIdentityCache(DEFAULT_SOURCES);

/**
 * The host directory's name: `m-` (machine id) or `h-` (hostname) and the
 * first 16 hex characters of the SHA-256 of the trimmed, lower-cased id.
 */
export function validationSlotHostDirname(identity: HostIdentity): string {
  const digest = createHash("sha256").update(identity.id.trim().toLowerCase()).digest("hex");
  return `${identity.kind === "machine" ? "m" : "h"}-${digest.slice(0, 16)}`;
}

/**
 * The slot directory `env` names in `NDX_VALIDATION_SLOT_DIR`, when that is an
 * absolute path. Handed down by hench or by a slot holder, it is used as is.
 */
export function validationSlotDirFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const named = env[VALIDATION_SLOT_DIR_ENV];
  return named && isAbsolute(named) ? named : undefined;
}

/**
 * The slot directory: the one `NDX_VALIDATION_SLOT_DIR` names, without a
 * lookup, else this host's directory under the ndx home `env` resolves to.
 * `identity` is the host's identity, or the cache to read it from.
 *
 * @throws {HostIdentityLookupError} when the machine id could not be read.
 */
export async function resolveValidationSlotDir(
  env: NodeJS.ProcessEnv = process.env,
  identity: HostIdentity | (() => Promise<HostIdentity>) = hostIdentity,
): Promise<string> {
  const named = validationSlotDirFromEnv(env);
  if (named) return named;
  return hostSlotDir(env, typeof identity === "function" ? await identity() : identity);
}

/**
 * `resolveValidationSlotDir` without waiting: undefined while the host's
 * identity is still being read, or while its failure is remembered
 * (`cache.peek()` starts a lookup when none runs). For paths that must never
 * wait on a lookup, such as the one before each confined spawn.
 */
export function peekValidationSlotDir(
  env: NodeJS.ProcessEnv = process.env,
  cache: Pick<HostIdentityCache, "peek"> = hostIdentity,
): string | undefined {
  const named = validationSlotDirFromEnv(env);
  if (named) return named;
  const known = cache.peek();
  return known ? hostSlotDir(env, known) : undefined;
}

function hostSlotDir(env: NodeJS.ProcessEnv, identity: HostIdentity): string {
  return join(resolveNdxHome({ env }), VALIDATION_SLOT_DIRNAME, validationSlotHostDirname(identity));
}
