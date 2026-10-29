/**
 * Whether this host lets the test user create symbolic links.
 *
 * On Windows that needs Developer Mode or an elevated token, so suites that
 * exercise link resolution skip rather than fail where links cannot be made.
 * Probed once per process.
 */

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let resolved: boolean | undefined;

export function symlinksSupported(): boolean {
  if (resolved !== undefined) return resolved;
  const dir = mkdtempSync(join(tmpdir(), "hench-symlink-probe-"));
  try {
    writeFileSync(join(dir, "target"), "");
    symlinkSync(join(dir, "target"), join(dir, "link"), "file");
    resolved = true;
  } catch {
    resolved = false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return resolved;
}
