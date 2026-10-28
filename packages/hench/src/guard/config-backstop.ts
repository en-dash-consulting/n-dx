/**
 * The backstop that keeps a run from leaving n-dx's own config files changed.
 *
 * The guard refuses `NDX_CONFIG_BLOCKED_PATHS` to hench's file tools, and the
 * Claude CLI is spawned with `Edit(...)` denies for them. Neither covers every
 * route: `codex exec` has no per-path deny, an allowed command (`node -e`,
 * `npm`) writes any file, and a deny matched case-sensitively misses
 * `.N-DX.local.json` on a case-insensitive filesystem. The local config is read
 * as the user's own with no trust review, so a write that got through would
 * widen the env policy, the CLI path or the endpoint of everything the run
 * spawns next (#686).
 *
 * So the run's start snapshots the files, and every seam where an agent hands
 * control back — a vendor CLI exiting, a tool call returning, finalization —
 * compares them and puts back whatever changed. It compares content at the
 * canonical paths, so a write under any spelling the filesystem folds onto them
 * is caught, and it does not care which tool or vendor wrote.
 *
 * A write found is reported by path and kind, never by content: the content is
 * what the agent was steered into writing, and it can carry credentials.
 */

import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { NDX_CONFIG_BLOCKED_PATHS } from "../prd/llm-gateway.js";

/**
 * The files under `.claude/` and `.codex/` that configure what the vendor CLI
 * runs: hooks, permissions, MCP servers, sandbox and approval policy.
 *
 * Only these are snapshotted. The directories also hold skills, commands and,
 * in a checkout like n-dx's own, whole agent worktrees; the guard keeps hench's
 * tools out of all of it, but copying it on every tool call would cost far more
 * than the settings it protects are worth.
 */
export const ASSISTANT_SETTINGS_FILES: readonly string[] = [
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".codex/config.toml",
];

/**
 * Every file the backstop restores, relative to the project root: the blocked
 * paths that name a file (both layouts' config and local config, `.mcp.json`)
 * and {@link ASSISTANT_SETTINGS_FILES} for the blocked directories.
 */
export const PROTECTED_CONFIG_FILES: readonly string[] = [
  ...NDX_CONFIG_BLOCKED_PATHS.filter((p) => !p.includes("*")),
  ...ASSISTANT_SETTINGS_FILES,
];

/** How a protected file differed from the snapshot. */
export type ProtectedConfigChange = "created" | "modified" | "deleted";

/** One protected file a run changed. Names the path, never the content. */
export interface ProtectedConfigWrite {
  /** Project-relative path, as listed in {@link PROTECTED_CONFIG_FILES}. */
  path: string;
  change: ProtectedConfigChange;
  /** False when the snapshot could not be put back; the file is left as the agent wrote it. */
  restored: boolean;
}

type Entry =
  | { kind: "absent" }
  | { kind: "file"; content: Buffer; mode: number }
  | { kind: "symlink"; target: string; content: Buffer | null }
  | { kind: "directory" }
  /** A FIFO, socket or device: compared by kind only, never read. */
  | { kind: "special" };

/**
 * The content behind a symlink, when it leads to a regular file. Anything
 * else is not read: a link to `/dev/zero` or a FIFO would never finish.
 */
function linkedFileContent(abs: string): Buffer | null {
  try {
    return statSync(abs).isFile() ? readFileSync(abs) : null;
  } catch {
    // Dangling, or pointing at something unreadable: only the link itself is compared.
    return null;
  }
}

function readEntry(abs: string): Entry {
  let stat;
  try {
    stat = lstatSync(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent" };
    throw err;
  }
  if (stat.isSymbolicLink()) return { kind: "symlink", target: readlinkSync(abs), content: linkedFileContent(abs) };
  if (stat.isDirectory()) return { kind: "directory" };
  // Only a regular file is read; reading a FIFO an agent left here would hang the run.
  if (!stat.isFile()) return { kind: "special" };
  return { kind: "file", content: readFileSync(abs), mode: stat.mode & 0o777 };
}

function sameEntry(a: Entry, b: Entry): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "absent":
    case "directory":
    case "special":
      return true;
    case "file":
      return a.content.equals((b as typeof a).content);
    case "symlink": {
      const other = b as typeof a;
      if (a.target !== other.target) return false;
      // A dangling link's content is not compared; a readable one's is, since
      // a write through the user's own link lands in the file it points at.
      return a.content === null || (other.content !== null && a.content.equals(other.content));
    }
  }
}

function changeOf(before: Entry, after: Entry): ProtectedConfigChange {
  if (before.kind === "absent") return "created";
  if (after.kind === "absent") return "deleted";
  return "modified";
}

/** Put the snapshot back at `abs`. Never writes through a link the agent made. */
function putBack(abs: string, before: Entry, after: Entry): void {
  if (before.kind === "symlink" && after.kind === "symlink" && after.target === before.target) {
    // The user's own link, written through: restore the file it points at.
    if (before.content !== null) writeFileSync(abs, before.content);
    return;
  }
  if (after.kind !== "absent") rmSync(abs, { recursive: true, force: true });
  switch (before.kind) {
    case "absent":
      return;
    case "directory":
      mkdirSync(abs, { recursive: true });
      return;
    case "file":
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, before.content, { mode: before.mode, flag: "wx" });
      return;
    case "symlink":
      mkdirSync(dirname(abs), { recursive: true });
      symlinkSync(before.target, abs);
      return;
    case "special":
      throw new Error("a special file cannot be recreated");
  }
}

/**
 * Run a restoring step, reporting whether it succeeded. A step that fails is
 * reported as not restored, which fails the run; it is not retried or hidden.
 */
function attempt(step: () => void): boolean {
  try {
    step();
    return true;
  } catch {
    return false;
  }
}

function tryPutBack(abs: string, before: Entry, after: Entry): boolean {
  return attempt(() => putBack(abs, before, after));
}

/**
 * A snapshot of the protected config files, taken before the agent runs.
 *
 * {@link restore} is safe to call at every seam: it reads a handful of small
 * files and writes only what changed. Every write found is kept in
 * {@link writes} for the run to report when it finalizes.
 */
export class ConfigBackstop {
  private readonly found = new Map<string, ProtectedConfigWrite>();

  private constructor(
    private readonly projectDir: string,
    private readonly snapshot: ReadonlyMap<string, Entry>,
    /** The protected files' parent directories that did not exist at the snapshot. */
    private readonly absentParents: ReadonlySet<string>,
  ) {}

  /** Snapshot {@link PROTECTED_CONFIG_FILES} under `projectDir` as they are now. */
  static capture(projectDir: string): ConfigBackstop {
    const snapshot = new Map<string, Entry>();
    const absentParents = new Set<string>();
    for (const rel of PROTECTED_CONFIG_FILES) {
      snapshot.set(rel, readEntry(join(projectDir, rel)));
      const parent = dirname(rel);
      if (parent !== "." && readEntry(join(projectDir, parent)).kind === "absent") absentParents.add(parent);
    }
    return new ConfigBackstop(projectDir, snapshot, absentParents);
  }

  /**
   * Remove the directory a created file was written into when it did not
   * exist at the snapshot and is empty now. An empty `.ndx/` left behind would
   * switch every later command to the `.ndx/` layout. A directory still
   * holding something is left: what else is in it is not config.
   */
  private removeCreatedParent(rel: string): void {
    const parent = dirname(rel);
    if (!this.absentParents.has(parent)) return;
    const abs = join(this.projectDir, parent);
    if (readEntry(abs).kind === "directory" && readdirSync(abs).length === 0) rmdirSync(abs);
  }

  /**
   * Put back every protected file that differs from the snapshot.
   *
   * Returns the writes found by this call. A file that cannot be read or put
   * back is reported with `restored: false` rather than thrown: the run fails
   * on it either way, and the other files still have to be put back.
   */
  restore(): ProtectedConfigWrite[] {
    const now: ProtectedConfigWrite[] = [];
    for (const [rel, before] of this.snapshot) {
      const abs = join(this.projectDir, rel);
      let after: Entry | null;
      try {
        after = readEntry(abs);
      } catch {
        // Unreadable now, though it was readable at the snapshot.
        after = null;
      }
      if (after && sameEntry(before, after)) continue;
      const write: ProtectedConfigWrite = after
        ? { path: rel, change: changeOf(before, after), restored: tryPutBack(abs, before, after) }
        : { path: rel, change: "modified", restored: false };
      if (write.restored && write.change === "created") {
        write.restored = attempt(() => this.removeCreatedParent(rel));
      }
      now.push(write);
      // The first change decides the kind; a later failure to put it back sticks.
      const earlier = this.found.get(rel);
      this.found.set(rel, earlier ? { ...earlier, restored: earlier.restored && write.restored } : write);
    }
    return now;
  }

  /** Every write found since the snapshot, one per path. */
  get writes(): ProtectedConfigWrite[] {
    return [...this.found.values()];
  }
}

/**
 * The finding a run reports for protected-config writes: each path and what
 * happened to it, never the content.
 */
export function formatProtectedConfigFinding(writes: readonly ProtectedConfigWrite[]): string {
  const parts = writes.map((w) => `${w.path} (${w.change}, ${w.restored ? "restored" : "NOT restored"})`);
  const unrestored = writes.some((w) => !w.restored);
  return (
    `The agent changed n-dx's own config, which no run may write: ${parts.join(", ")}. ` +
    (unrestored
      ? "Inspect the files not restored before running n-dx again."
      : "The files were put back as they were before the run.")
  );
}
