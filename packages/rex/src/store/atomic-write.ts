/**
 * Atomic file write — write to a temp file, then rename.
 *
 * Prevents torn reads when concurrent CLI invocations (e.g. in CI)
 * read a file while another process is mid-write. `rename()` on the
 * same filesystem is atomic on POSIX and near-atomic on Windows, where a
 * rename over a file another process has open fails transiently and is
 * retried (see {@link renameReplacing}).
 *
 * @module rex/store/atomic-write
 */

import { randomUUID } from "node:crypto";
import { writeFile, rename, rm } from "node:fs/promises";

/**
 * Build the sibling temp path an atomic write occupies while `filePath` is in
 * flight: `<filePath>.<pid>.<uuid>.tmp`.
 *
 * Same directory as the target, so the `rename` stays on one filesystem and is
 * therefore atomic. Unique per process and per call, so two writers to the same
 * file cannot clobber each other's in-flight copy.
 *
 * Exported because *readers* of a tree need to recognise these names too, not
 * just writers. `snapshotPRDTree` walks `.rex/prd_tree/` with no lock held; a
 * temp file that exists when it reads the directory and is gone by the time it
 * stats it used to abort the whole command with ENOENT. Callers filter with
 * {@link isAtomicWriteTempPath} rather than re-deriving the shape.
 */
export function atomicWriteTempPath(filePath: string): string {
  return `${filePath}.${process.pid}.${randomUUID()}.tmp`;
}

/**
 * The `.<pid>.<uuid>.tmp` tail {@link atomicWriteTempPath} appends.
 *
 * Deliberately narrow — it matches the pid and UUID segments, not a bare
 * `.tmp` suffix — so a PRD file a user happens to name `notes.tmp` is still
 * treated as content.
 */
const ATOMIC_WRITE_TEMP_TAIL =
  /\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;

/**
 * True when `path` names an atomic write's in-flight temp file.
 *
 * A temp file is not content: it exists only between the `write` and the
 * `rename`, and anything walking the tree concurrently — a snapshot, a parser —
 * must skip it rather than treat it as a sibling of the real file.
 *
 * Kept in step with {@link atomicWriteTempPath} by a unit test that feeds this
 * matcher the builder's own output.
 */
export function isAtomicWriteTempPath(path: string): boolean {
  return ATOMIC_WRITE_TEMP_TAIL.test(path);
}

/**
 * Error codes Windows reports when a rename cannot replace its target because
 * another handle has it open: a concurrent reader (an unlocked snapshot load
 * reads `tree-meta.json` while the lock holder rewrites it), Defender, or the
 * search indexer. `MoveFileEx` fails with a sharing violation or
 * ERROR_ACCESS_DENIED, which Node surfaces as one of these. POSIX lets a
 * rename replace an open file, so there these codes mean a real fault.
 */
const TRANSIENT_WIN32_RENAME_CODES: ReadonlySet<string> = new Set(["EPERM", "EACCES", "EBUSY"]);

/**
 * Waits between win32 rename attempts: doubling from 10 ms, about 1.3 s in
 * all. Long enough for a reader or scanner to drop its handle, short enough
 * that a genuine permission fault still fails promptly. graceful-fs and
 * write-file-atomic retry the same way for the same reason.
 */
export const RENAME_RETRY_DELAYS_MS: readonly number[] = [10, 20, 40, 80, 160, 320, 640];

/** Seams for {@link renameReplacing}; the defaults are the real platform and fs. */
export interface RenameReplacingOptions {
  platform?: NodeJS.Platform;
  rename?: (from: string, to: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Rename `tmpPath` over `filePath` — the publishing step of every atomic write.
 *
 * On win32 a rename that fails with a sharing-conflict code is retried after
 * each of {@link RENAME_RETRY_DELAYS_MS}; any other code, or any other
 * platform, fails at once. When the rename finally fails, the temp file is
 * removed and the last rename error is rethrown unchanged.
 */
export async function renameReplacing(
  tmpPath: string,
  filePath: string,
  options: RenameReplacingOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const renameFile = options.rename ?? rename;
  const sleep = options.sleep ?? sleepMs;
  const delays = platform === "win32" ? RENAME_RETRY_DELAYS_MS : [];

  for (let attempt = 0; ; attempt++) {
    try {
      await renameFile(tmpPath, filePath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt < delays.length && code !== undefined && TRANSIENT_WIN32_RENAME_CODES.has(code)) {
        await sleep(delays[attempt]);
        continue;
      }
      await removeTempFile(tmpPath);
      throw error;
    }
  }
}

/**
 * Remove a temp file whose rename failed. The rename error is what the caller
 * needs, so a cleanup failure is reported as a warning rather than replacing it.
 */
async function removeTempFile(tmpPath: string): Promise<void> {
  try {
    await rm(tmpPath, { force: true });
  } catch (cleanupError) {
    process.emitWarning(
      `rex: could not remove temp file ${tmpPath} after a failed rename: ${String(cleanupError)}`,
    );
  }
}

/**
 * Write a pre-serialized string atomically by writing to a sibling temp file
 * first, then renaming into place with {@link renameReplacing}.
 *
 * Every temp-then-rename write in the rex store goes through here, so the
 * Windows retry covers all of them.
 */
export async function atomicWrite(
  filePath: string,
  content: string,
  options?: RenameReplacingOptions,
): Promise<void> {
  const tmpPath = atomicWriteTempPath(filePath);
  await writeFile(tmpPath, content, "utf-8");
  await renameReplacing(tmpPath, filePath, options);
}

/**
 * Write JSON data atomically by writing to a sibling temp file first,
 * then renaming into place.
 *
 * Uses `JSON.stringify` by default. For deterministic output (e.g.
 * canonical JSON with sorted keys), pass a custom serializer.
 */
export async function atomicWriteJSON(
  filePath: string,
  data: unknown,
  serializer: (data: unknown) => string = (d) => JSON.stringify(d, null, 2),
): Promise<void> {
  await atomicWrite(filePath, serializer(data));
}
