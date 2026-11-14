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
 * run beside the holder. The id is hashed, so no raw machine id lands on
 * disk. The hostname is only the fallback when no id can be read.
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

/** What names this host: a stable machine id, or the hostname when none can be read. */
export interface HostIdentity {
  kind: "machine" | "hostname";
  id: string;
}

/** The platform lookups `readHostIdentity` uses; injectable for tests. */
export interface HostIdentitySources {
  platform: NodeJS.Platform;
  /** A file's contents; rejects when it cannot be read. */
  readFile(path: string): Promise<string>;
  /** A command's stdout, run without a shell; undefined when it fails or times out. */
  run(file: string, args: string[]): Promise<string | undefined>;
  hostname(): string;
}

/** Linux machine-id files, in lookup order. */
export const LINUX_MACHINE_ID_FILES = ["/etc/machine-id", "/var/lib/dbus/machine-id"] as const;

/** How long a platform lookup command may run. */
const LOOKUP_TIMEOUT_MS = 2_000;

async function runLookup(file: string, args: string[]): Promise<string | undefined> {
  const result = await exec(file, args, { cwd: tmpdir(), timeout: LOOKUP_TIMEOUT_MS });
  return result.launched && result.exitCode === 0 ? result.stdout : undefined;
}

const DEFAULT_SOURCES: HostIdentitySources = {
  platform: process.platform,
  readFile: (path) => readFile(path, "utf-8"),
  run: runLookup,
  hostname,
};

async function readMachineIdFile(sources: HostIdentitySources, path: string): Promise<string | undefined> {
  let id: string;
  try {
    id = (await sources.readFile(path)).trim();
  } catch {
    // Missing or unreadable: the caller tries the next file, then the hostname.
    return undefined;
  }
  // An unset id ("" or "uninitialized" during first boot) is not one.
  return /^[0-9a-f]{32}$/i.test(id) ? id : undefined;
}

async function linuxMachineId(sources: HostIdentitySources): Promise<string | undefined> {
  for (const path of LINUX_MACHINE_ID_FILES) {
    const id = await readMachineIdFile(sources, path);
    if (id) return id;
  }
  return undefined;
}

async function commandMatch(
  sources: HostIdentitySources,
  file: string,
  args: string[],
  pattern: RegExp,
): Promise<string | undefined> {
  const stdout = await sources.run(file, args);
  return (stdout && pattern.exec(stdout)?.[1]?.trim()) || undefined;
}

function machineId(sources: HostIdentitySources): Promise<string | undefined> {
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
      return Promise.resolve(undefined);
  }
}

/** This host's identity, read now: its machine id, else its hostname. */
export async function readHostIdentity(sources: HostIdentitySources = DEFAULT_SOURCES): Promise<HostIdentity> {
  const id = await machineId(sources);
  return id ? { kind: "machine", id } : { kind: "hostname", id: sources.hostname() };
}

let cachedIdentity: Promise<HostIdentity> | undefined;

/** This host's identity, read once per process. */
export function hostIdentity(): Promise<HostIdentity> {
  cachedIdentity ??= readHostIdentity();
  return cachedIdentity;
}

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
