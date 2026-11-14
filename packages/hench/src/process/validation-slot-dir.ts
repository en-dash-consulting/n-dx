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
 *   and warns; the next call retries the lookup.
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
import { join } from "node:path";
import { resolveNdxHome } from "../prd/llm-gateway.js";
import { exec } from "./exec.js";
import { VALIDATION_SLOT_DIRNAME } from "./validation-slot.js";

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

/** A machine-id lookup that failed in a way that may not recur. Not cached; never the hostname. */
export class HostIdentityLookupError extends Error {
  constructor(lookup: string, reason: string) {
    super(`could not read this host's machine id (${lookup}: ${reason}); the next validation retries it`);
    this.name = "HostIdentityLookupError";
  }
}

/** Linux machine-id files, in lookup order. */
export const LINUX_MACHINE_ID_FILES = ["/etc/machine-id", "/var/lib/dbus/machine-id"] as const;

/** How long a platform lookup command may run; see the module header. */
export const LOOKUP_TIMEOUT_MS = 10_000;

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

/**
 * `readHostIdentity(sources)`, kept once it resolves. A rejected lookup is
 * forgotten, so the next call retries it.
 */
export function createHostIdentityCache(sources: HostIdentitySources): () => Promise<HostIdentity> {
  let cached: Promise<HostIdentity> | undefined;
  return () => {
    if (!cached) {
      const attempt = readHostIdentity(sources);
      cached = attempt;
      // The caller sees the rejection through `attempt`; this only forgets it.
      attempt.then(undefined, () => {
        if (cached === attempt) cached = undefined;
      });
    }
    return cached;
  };
}

/** This host's identity, read once per process; a transient failure is retried on the next call. */
export const hostIdentity: () => Promise<HostIdentity> = createHostIdentityCache(DEFAULT_SOURCES);

/**
 * The host directory's name: `m-` (machine id) or `h-` (hostname) and the
 * first 16 hex characters of the SHA-256 of the trimmed, lower-cased id.
 */
export function validationSlotHostDirname(identity: HostIdentity): string {
  const digest = createHash("sha256").update(identity.id.trim().toLowerCase()).digest("hex");
  return `${identity.kind === "machine" ? "m" : "h"}-${digest.slice(0, 16)}`;
}

/** This host's slot directory under the ndx home `env` resolves to. */
export async function resolveValidationSlotDir(
  env: NodeJS.ProcessEnv = process.env,
  identity?: HostIdentity,
): Promise<string> {
  const host = validationSlotHostDirname(identity ?? (await hostIdentity()));
  return join(resolveNdxHome({ env }), VALIDATION_SLOT_DIRNAME, host);
}
