/**
 * Atomic JSON file write — write to a temp file, then rename.
 *
 * Prevents torn reads when concurrent CLI invocations (e.g. in CI)
 * read a file while another process is mid-write. `rename()` on the
 * same filesystem is atomic on POSIX and near-atomic on Windows.
 *
 * @module rex/store/atomic-write
 */

import { writeFile, rename } from "node:fs/promises";

/**
 * Write JSON data atomically by writing to a sibling temp file first,
 * then renaming into place.
 */
export async function atomicWriteJSON(
  filePath: string,
  data: unknown,
): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, filePath);
}
