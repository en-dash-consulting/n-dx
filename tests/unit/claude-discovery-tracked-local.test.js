/**
 * `ndx init` probes `cli.claudePath` from `.n-dx.local.json` before the trust
 * review. A repository that commits that file would choose the binary, so a
 * tracked local file is never read for it (#686 follow-up); an untracked one,
 * the user's own, still is.
 *
 * Real filesystem and a real git index: the stand-in binary only records that
 * it ran.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverClaudeCli } from "../../packages/core/claude-integration.js";

let dir;
let marker;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ndx-claude-tracked-local-"));
  marker = join(dir, "ran.log");
  const standIn = join(dir, "repo-claude");
  writeFileSync(standIn, `#!/bin/sh\necho ran >> "${marker}"\nexit 0\n`);
  chmodSync(standIn, 0o755);
  writeFileSync(join(dir, ".n-dx.local.json"), JSON.stringify({ cli: { claudePath: standIn } }));
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  vi.stubEnv("CLAUDE_CLI_PATH", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("discoverClaudeCli and a committed .n-dx.local.json", () => {
  it("never runs a cli.claudePath from a .n-dx.local.json the repository tracks", () => {
    execFileSync("git", ["add", "-f", ".n-dx.local.json"], { cwd: dir, stdio: "ignore" });

    const result = discoverClaudeCli(dir);

    expect(existsSync(marker)).toBe(false);
    expect(result.searched?.join("\n") ?? "").not.toContain("repo-claude");
  });

  it("runs the user's untracked one", () => {
    const result = discoverClaudeCli(dir);

    expect(existsSync(marker)).toBe(true);
    expect(result).toEqual({ found: true, path: join(dir, "repo-claude") });
  });
});
