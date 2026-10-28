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
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { NDX_CONFIG_BLOCKED_PATHS, NDX_CONTAINER_DIRNAME } from "../prd/llm-gateway.js";

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

/**
 * The directories holding {@link PROTECTED_CONFIG_FILES}: `.claude`, `.codex`
 * and `.ndx`. Each is checked before any file under it is restored, since a
 * directory swapped for a link would carry the restore out of the project.
 */
export const PROTECTED_CONFIG_PARENTS: readonly string[] = [
  ...new Set(PROTECTED_CONFIG_FILES.map((rel) => dirname(rel)).filter((parent) => parent !== ".")),
];

/**
 * How a protected path differed from the snapshot. `replaced` is a protected
 * directory swapped for something else, most often a link out of the project.
 */
export type ProtectedConfigChange = "created" | "modified" | "deleted" | "replaced";

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

/**
 * What a protected directory is: its kind without following a link, and where
 * it really is. Two readings that agree mean a write under it lands where it
 * landed at the snapshot.
 */
type Parent =
  | { kind: "absent" }
  | { kind: "directory"; real: string }
  /** `real` is null for a link that resolves nowhere: dangling, or a loop. */
  | { kind: "symlink"; target: string; real: string | null }
  | { kind: "other" };

function readParent(abs: string): Parent {
  let stat;
  try {
    stat = lstatSync(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent" };
    throw err;
  }
  if (stat.isDirectory()) return { kind: "directory", real: realpathSync.native(abs) };
  if (!stat.isSymbolicLink()) return { kind: "other" };
  return { kind: "symlink", target: readlinkSync(abs), real: resolvedOrNull(abs) };
}

/** Where a link leads, or null when it leads nowhere (dangling, or a loop). */
function resolvedOrNull(abs: string): string | null {
  try {
    return realpathSync.native(abs);
  } catch {
    // Nothing under such a link can be read or written; the files' own reads say so.
    return null;
  }
}

function sameParent(a: Parent, b: Parent): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "directory") return a.real === (b as typeof a).real;
  if (a.kind === "symlink") {
    const other = b as typeof a;
    return a.target === other.target && a.real === other.real;
  }
  return true;
}

/** Remove whatever is at `abs` without following it: a link goes, never what it points at. */
function removeInPlace(abs: string, now: Parent): void {
  if (now.kind === "directory") rmSync(abs, { recursive: true, force: true });
  else if (now.kind !== "absent") unlinkSync(abs);
}

/** The snapshot could not be taken; the run must not start without it. */
export class ConfigBackstopError extends Error {
  constructor(readonly path: string, cause: unknown) {
    const code = (cause as NodeJS.ErrnoException | undefined)?.code;
    super(
      `Cannot snapshot n-dx's own config before the run: ${path} could not be read` +
      `${code ? ` (${code})` : ""}. Fix or remove it, then run again.`,
    );
    this.name = "ConfigBackstopError";
  }
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
 *
 * The backstop runs outside any sandbox, so it never writes or deletes through
 * a protected directory that is no longer the one it snapshotted: a `.claude/`
 * swapped for a link to the user's `~/.claude` is replaced by a directory
 * before anything under it is restored, and the link's target is left alone.
 */
export class ConfigBackstop {
  private readonly found = new Map<string, ProtectedConfigWrite>();

  private constructor(
    private readonly projectDir: string,
    private readonly snapshot: ReadonlyMap<string, Entry>,
    /** Each of {@link PROTECTED_CONFIG_PARENTS} as it was at the snapshot. */
    private readonly parents: ReadonlyMap<string, Parent>,
  ) {}

  /**
   * Snapshot {@link PROTECTED_CONFIG_FILES} under `projectDir` as they are now.
   *
   * @throws {ConfigBackstopError} when a protected path cannot be read, such
   *   as a directory that is a link loop or unreadable. Restoring would be
   *   blind, so the run must not start.
   */
  static capture(projectDir: string): ConfigBackstop {
    const parents = new Map<string, Parent>();
    for (const rel of PROTECTED_CONFIG_PARENTS) {
      parents.set(rel, readOrRefuse(rel, () => readParent(join(projectDir, rel))));
    }
    const snapshot = new Map<string, Entry>();
    for (const rel of PROTECTED_CONFIG_FILES) {
      snapshot.set(rel, readOrRefuse(rel, () => readEntry(join(projectDir, rel))));
    }
    return new ConfigBackstop(projectDir, snapshot, parents);
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
    const record = (write: ProtectedConfigWrite): void => {
      now.push(write);
      // The first change decides the kind; a later failure to put it back sticks.
      const earlier = this.found.get(write.path);
      this.found.set(write.path, earlier ? { ...earlier, restored: earlier.restored && write.restored } : write);
    };

    // Directories first: a file is restored only under the directory it was
    // snapshotted in, never through whatever replaced it.
    const settled = new Map<string, Parent>();
    for (const rel of PROTECTED_CONFIG_PARENTS) {
      const parent = this.settleParent(rel, record);
      if (parent) settled.set(rel, parent);
    }

    for (const [rel, before] of this.snapshot) {
      const parent = dirname(rel);
      // A directory that could not be settled is reported; nothing under it is touched.
      if (parent !== "." && !settled.has(parent)) continue;
      const abs = join(this.projectDir, rel);
      let after: Entry | null;
      try {
        after = readEntry(abs);
      } catch {
        // Unreadable now, though it was readable at the snapshot.
        after = null;
      }
      if (after && sameEntry(before, after)) continue;
      // Checked again just before writing: the directory must still be the one
      // settled above, or the write could leave the project.
      const write: ProtectedConfigWrite = after && this.parentStill(parent, settled)
        ? { path: rel, change: changeOf(before, after), restored: tryPutBack(abs, before, after) }
        : { path: rel, change: after ? changeOf(before, after) : "modified", restored: false };
      if (write.restored && write.change === "created") {
        write.restored = attempt(() => this.removeCreatedParent(rel));
      }
      record(write);
    }

    this.settleLayout(record);
    return now;
  }

  /** Every write found since the snapshot, one per path. */
  get writes(): ProtectedConfigWrite[] {
    return [...this.found.values()];
  }

  /**
   * Bring a protected directory back to what it was at the snapshot when it
   * was swapped for something else. Returns what it is now, for the files
   * under it to be restored into, or null when they must not be: it could not
   * be read or put back, which is reported instead.
   */
  private settleParent(rel: string, record: (w: ProtectedConfigWrite) => void): Parent | null {
    const abs = join(this.projectDir, rel);
    const before = this.parents.get(rel)!;
    let now: Parent;
    try {
      now = readParent(abs);
    } catch {
      record({ path: rel, change: "modified", restored: false });
      return null;
    }
    if (sameParent(before, now)) return now;
    // Created or deleted as a real directory inside the project: the files
    // under it are put back or removed the ordinary way.
    const inProject = now.kind === "directory" && now.real === join(realpathSync.native(this.projectDir), rel);
    if (before.kind === "absent" && inProject) return now;
    if (before.kind === "directory" && (inProject || now.kind === "absent")) return now;

    const restored = attempt(() => {
      removeInPlace(abs, now);
      if (before.kind === "directory") mkdirSync(abs);
      else if (before.kind === "symlink") symlinkSync(before.target, abs);
      else if (before.kind === "other") throw new Error("a special file cannot be recreated");
    });
    const after = restored ? readParent(abs) : now;
    // A directory comes back holding only the config files: whatever else was
    // in it went wherever the agent moved it.
    const back = restored && (before.kind === "directory" ? after.kind === "directory" : sameParent(before, after));
    record({ path: rel, change: before.kind === "absent" ? "created" : "replaced", restored: back });
    return back ? after : null;
  }

  /** True when `parent` is still what {@link settleParent} left it as. */
  private parentStill(parent: string, settled: ReadonlyMap<string, Parent>): boolean {
    if (parent === ".") return true;
    try {
      return sameParent(settled.get(parent)!, readParent(join(this.projectDir, parent)));
    } catch {
      return false;
    }
  }

  /**
   * Keep the layout the run started in. Every n-dx command picks the `.ndx/`
   * or the legacy layout by whether `.ndx/` exists, so a `.ndx/` created during
   * the run would make the next command skip the user's `.n-dx.local.json` and
   * read what the agent put there instead. It holds nothing of the user's, so
   * it is removed whole. A `.ndx/` that went missing cannot be rebuilt (the PRD
   * in it is gone), so that is reported as not restored.
   */
  private settleLayout(record: (w: ProtectedConfigWrite) => void): void {
    const rel = NDX_CONTAINER_DIRNAME;
    const before = this.parents.get(rel);
    if (!before) return;
    const abs = join(this.projectDir, rel);
    let now: Parent;
    try {
      now = readParent(abs);
    } catch {
      record({ path: rel, change: "modified", restored: false });
      return;
    }
    if (before.kind === "absent" && now.kind !== "absent") {
      record({ path: rel, change: "created", restored: attempt(() => removeInPlace(abs, now)) });
    } else if (before.kind === "directory" && now.kind === "absent") {
      record({ path: rel, change: "deleted", restored: false });
    }
  }

  /**
   * Remove the directory a created file was written into when it did not
   * exist at the snapshot and is empty now. A directory still holding
   * something is left: what else is in it is not config.
   */
  private removeCreatedParent(rel: string): void {
    const parent = dirname(rel);
    if (this.parents.get(parent)?.kind !== "absent") return;
    const abs = join(this.projectDir, parent);
    if (readEntry(abs).kind === "directory" && readdirSync(abs).length === 0) rmdirSync(abs);
  }
}

/** Read one protected path for the snapshot, refusing the run when it cannot be read. */
function readOrRefuse<T>(rel: string, read: () => T): T {
  try {
    return read();
  } catch (err) {
    throw new ConfigBackstopError(rel, err);
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
