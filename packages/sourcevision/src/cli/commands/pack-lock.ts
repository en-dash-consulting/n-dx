/**
 * The pack directory's writer lock, `<pack dir>.lock`. Two `sv pack` writers
 * can share one pack directory (two terminals, two worktrees, CI jobs on one
 * ndx home), and npm takes no lock on a `--prefix`, so `add`, `add --from` and
 * `remove` each hold this lock for their whole run.
 *
 * The lock is published whole: its content is written to a temporary file that
 * is then hard-linked into place, so no reader sees a half-written lock (the
 * PRD lock's pattern, `packages/rex/src/store/file-lock.ts`). A second writer
 * fails at once naming the holder's PID. A lock whose PID is dead is taken
 * over: it is renamed aside and taken over only when the renamed file is the
 * one judged dead, so a recovery never discards a live writer's fresh lock.
 *
 * @module sourcevision/cli/commands/pack-lock
 */

import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { CLIError } from "../errors.js";

/** What a lock file records. */
export interface PackLockHolder {
  readonly pid: number;
  readonly token: string;
  /** The `sv pack` subcommand holding it. */
  readonly command: string;
  /** ISO time it was taken. */
  readonly since: string;
}

/** Hard-link failures meaning the filesystem has no hard links. */
const NO_LINK_CODES = new Set(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM", "EXDEV"]);

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

/** `<pack dir>.lock`. */
export const packLockPath = (packDir: string): string => `${packDir}.lock`;

/** `kill(pid, 0)`; EPERM means the process exists but is not ours to signal. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) === "EPERM";
  }
}

function decode(content: string): PackLockHolder | null {
  let parsed: Partial<PackLockHolder>;
  try {
    parsed = JSON.parse(content) as Partial<PackLockHolder>;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { pid, token, command, since } = parsed;
  return typeof pid === "number" && typeof token === "string" && typeof command === "string" && typeof since === "string"
    ? { pid, token, command, since }
    : null;
}

/** The file's content, or undefined when it does not exist. */
function readIfPresent(file: string): string | undefined {
  try {
    return readFileSync(file, "utf-8");
  } catch (error) {
    if (codeOf(error) === "ENOENT") return undefined;
    throw error;
  }
}

/** Create `lockPath` holding `content` if no lock exists; false when one does. */
function tryPublish(lockPath: string, content: string, token: string): boolean {
  const temporary = `${lockPath}.${token}.tmp`;
  writeFileSync(temporary, content, { flag: "wx" });
  try {
    linkSync(temporary, lockPath);
    return true;
  } catch (error) {
    if (codeOf(error) === "EEXIST") return false;
    if (!NO_LINK_CODES.has(codeOf(error) ?? "")) throw error;
  } finally {
    unlinkSync(temporary);
  }
  // No hard links: an exclusive create, with a window in which the lock is empty.
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch (error) {
    if (codeOf(error) === "EEXIST") return false;
    throw error;
  }
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * Rename a dead holder's lock aside and drop it. A lock that changed since it
 * was judged (another writer recovered it and took the lock) is put back and
 * the recovery fails loudly.
 */
function takeOverStale(lockPath: string, judged: string, token: string): void {
  const aside = `${lockPath}.${token}.stale`;
  try {
    renameSync(lockPath, aside);
  } catch (error) {
    if (codeOf(error) === "ENOENT") return; // Another writer removed it first.
    throw error;
  }
  const moved = readFileSync(aside, "utf-8");
  if (moved === judged) {
    rmSync(aside, { force: true });
    return;
  }
  // Not the dead lock: another writer took the lock in between. Put it back.
  let restored = true;
  try {
    linkSync(aside, lockPath);
  } catch (error) {
    if (codeOf(error) !== "EEXIST") throw error;
    restored = false;
  } finally {
    rmSync(aside, { force: true });
  }
  const holder = decode(moved);
  throw new CLIError(
    `Another sv pack${holder ? ` (PID ${holder.pid}, ${holder.command})` : ""} took the pack directory lock ${lockPath} while this one was recovering a stale lock.`,
    restored ? "Wait for it to finish, then run the command again." : `Wait for it to finish; if no sv pack is running, delete ${lockPath}.`,
  );
}

function heldError(lockPath: string, packDir: string, holder: PackLockHolder | null): CLIError {
  if (!holder) {
    return new CLIError(
      `The pack directory ${packDir} is locked by ${lockPath}, which cannot be read as a lock.`,
      `If no sv pack is running, delete ${lockPath}.`,
    );
  }
  return new CLIError(
    `Another sv pack (PID ${holder.pid}, \`${holder.command}\` since ${holder.since}) is changing ${packDir}.`,
    `Run one sv pack writer at a time: wait for PID ${holder.pid} to finish. If it is not sv pack, delete ${lockPath}.`,
  );
}

/**
 * Take the pack directory's lock for `command` and return its release. Throws
 * a CLIError naming the holder when a live process holds it.
 */
export function acquirePackLock(packDir: string, command: string, isAlive: (pid: number) => boolean = pidAlive): () => void {
  const lockPath = packLockPath(packDir);
  mkdirSync(dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const content = JSON.stringify({ pid: process.pid, token, command, since: new Date().toISOString() } satisfies PackLockHolder);
  // Each pass either takes the lock, fails, or removes one dead lock; a few
  // passes are enough unless other writers keep racing this one.
  for (let pass = 0; pass < 5; pass++) {
    if (tryPublish(lockPath, content, token)) return () => releasePackLock(lockPath, token);
    const existing = readIfPresent(lockPath);
    if (existing === undefined) continue; // Released while looking.
    const holder = decode(existing);
    if (!holder || isAlive(holder.pid)) throw heldError(lockPath, packDir, holder);
    takeOverStale(lockPath, existing, token);
  }
  throw new CLIError(`Could not take the pack directory lock ${lockPath}: other sv pack writers keep taking it.`, "Run one sv pack writer at a time.");
}

/** Remove the lock only while it still carries `token`. */
function releasePackLock(lockPath: string, token: string): void {
  const content = readIfPresent(lockPath);
  if (content !== undefined && decode(content)?.token === token) unlinkSync(lockPath);
}

/** Run `fn` holding the pack directory's lock. */
export async function withPackLock<T>(packDir: string, command: string, fn: () => Promise<T>, isAlive?: (pid: number) => boolean): Promise<T> {
  const release = acquirePackLock(packDir, command, isAlive);
  try {
    return await fn();
  } finally {
    release();
  }
}
