/**
 * Temp-directory teardown that survives Windows file locking.
 *
 * Integration tests here follow one shape: `mkdtemp`, spawn a child that boots
 * the compiled server against that directory, assert on what it printed, then
 * `rm -r` the directory in a `finally`. On POSIX the removal is uneventful. On
 * Windows it is the flakiest line in the file:
 *
 *     Error: EBUSY: resource busy or locked, rmdir 'C:\...\Temp\ndx-port-zero-25sfaN'
 *
 * Windows refuses to unlink a file or directory while any handle to it is
 * open, and a just-exited child's handles are released by the kernel slightly
 * after `execFile`'s callback fires — plus virus scanners and the search
 * indexer open handles of their own on freshly written files. The assertions
 * had all passed; the test still failed, on cleanup, for a directory the OS
 * would have reaped anyway.
 *
 * So: retry (`fs.rm` re-attempts on EBUSY/EPERM/ENOTEMPTY when given
 * `maxRetries`), and if the handle is *still* held after a second of trying,
 * warn rather than fail — on Windows only. On POSIX an un-removable temp
 * directory means something genuinely went wrong, so it still throws.
 *
 * Separate from the child's working directory: spawn drivers with the package
 * as `cwd`, never the temp directory, because Windows locks a process's cwd
 * outright and no retry budget outlasts a process that has not been reaped.
 */

import { rm } from "node:fs/promises";

/** How long to keep retrying before giving up: 10 attempts, ~100ms apart. */
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 100;

/**
 * Remove a test temp directory, tolerating Windows' transient handle locks.
 *
 * Use in place of `rm(dir, { recursive: true, force: true })` in test
 * teardown. Not for production code and not for directories whose removal is
 * itself under test — this deliberately downgrades a failure to a warning.
 */
export async function removeTempDir(dir: string): Promise<void> {
  try {
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: MAX_RETRIES,
      retryDelay: RETRY_DELAY_MS,
    });
  } catch (err) {
    if (process.platform !== "win32") throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[temp-dir] leaving ${dir} behind: ${message}`);
  }
}
