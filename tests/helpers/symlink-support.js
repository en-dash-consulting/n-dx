/**
 * Symlink capability probe for tests that create symlinks.
 *
 * On Windows, creating a symlink requires either an elevated process or
 * Developer Mode; without one of those, `fs.symlinkSync` fails with EPERM.
 * Tests that exercise symlink-specific behaviour (bin shims, symlinked
 * project paths) should skip rather than fail on such machines — the
 * behaviour under test is real, the environment just cannot set it up.
 *
 * The probe runs once per process and caches its answer.
 */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cached = null;

/** True when this process may create symlinks (always true off-Windows). */
export function canCreateSymlinks() {
  if (cached !== null) return cached;
  if (process.platform !== "win32") {
    cached = true;
    return cached;
  }
  const dir = mkdtempSync(join(tmpdir(), "ndx-symlink-probe-"));
  try {
    const target = join(dir, "target.txt");
    writeFileSync(target, "");
    symlinkSync(target, join(dir, "link"));
    cached = true;
  } catch {
    cached = false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return cached;
}

/** Skip message for symlink-gated tests. */
export const SYMLINKS_UNAVAILABLE =
  "symlink creation not permitted (Windows without Developer Mode or elevation)";
