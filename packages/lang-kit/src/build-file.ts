/**
 * Size-capped reads of build files (pom.xml, Gradle scripts). A build file is
 * repository content, so its size is bounded before any scan of it: the
 * largest in the Java corpus is about 126 KiB. A reader may pass a larger cap
 * for one kind of file (`composer.lock`, in `php-composer.ts`).
 *
 * @module lang-kit/build-file
 */

import { open } from "node:fs/promises";

export const MAX_BUILD_FILE_BYTES = 1024 * 1024;

/** A file over its cap, not read. */
export interface OversizedBuildFile {
  oversized: number;
}

/**
 * File text, or its size when over `maxBytes` (default {@link MAX_BUILD_FILE_BYTES}).
 * Errors (ENOENT, EACCES, …) propagate.
 */
export async function readBuildFile(path: string, maxBytes = MAX_BUILD_FILE_BYTES): Promise<string | OversizedBuildFile> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size > maxBytes) return { oversized: size };
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

/** The notice for a skipped oversized file; `rel` is project-relative, POSIX, `maxBytes` the cap it was read with. */
export function oversizedNotice(rel: string, size: number, maxBytes = MAX_BUILD_FILE_BYTES): string {
  return `${rel} is ${size} bytes, over the ${maxBytes}-byte build file limit; skipped`;
}
