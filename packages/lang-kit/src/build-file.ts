/**
 * Size-capped reads of build files (pom.xml, Gradle scripts). A build file is
 * repository content, so its size is bounded before any scan of it: the
 * largest in the Java corpus is about 126 KiB.
 *
 * @module lang-kit/build-file
 */

import { open } from "node:fs/promises";

export const MAX_BUILD_FILE_BYTES = 1024 * 1024;

/** A file over {@link MAX_BUILD_FILE_BYTES}, not read. */
export interface OversizedBuildFile {
  oversized: number;
}

/** File text, or its size when over the cap. Errors (ENOENT, EACCES, …) propagate. */
export async function readBuildFile(path: string): Promise<string | OversizedBuildFile> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size > MAX_BUILD_FILE_BYTES) return { oversized: size };
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

/** The notice for a skipped oversized file; `rel` is project-relative, POSIX. */
export function oversizedNotice(rel: string, size: number): string {
  return `${rel} is ${size} bytes, over the ${MAX_BUILD_FILE_BYTES}-byte build file limit; skipped`;
}
