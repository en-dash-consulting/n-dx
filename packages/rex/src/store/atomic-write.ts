/**
 * Atomic file write — write to a temp file, then rename.
 *
 * Prevents torn reads when concurrent CLI invocations (e.g. in CI)
 * read a file while another process is mid-write. `rename()` on the
 * same filesystem is atomic on POSIX and near-atomic on Windows.
 *
 * @module rex/store/atomic-write
 */

import { randomUUID } from "node:crypto";
import { writeFile, rename } from "node:fs/promises";

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
 * Write a pre-serialized string atomically by writing to a sibling
 * temp file first, then renaming into place.
 */
export async function atomicWrite(
  filePath: string,
  content: string,
): Promise<void> {
  const tmpPath = atomicWriteTempPath(filePath);
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, filePath);
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
