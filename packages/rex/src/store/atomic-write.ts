/**
 * Atomic file write — write to a temp file, then rename.
 *
 * Prevents torn reads when concurrent CLI invocations (e.g. in CI)
 * read a file while another process is mid-write. `rename()` on the
 * same filesystem is atomic on POSIX and near-atomic on Windows.
 *
 * @module rex/store/atomic-write
 */

import { writeFile, rename } from "node:fs/promises";

/**
 * Write a pre-serialized string atomically by writing to a sibling
 * temp file first, then renaming into place.
 */
export async function atomicWrite(
  filePath: string,
  content: string,
): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
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
