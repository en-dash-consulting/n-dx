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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { discoverClaudeCli } from "../../packages/core/claude-integration.js";

let dir;
let marker;

/** True when this filesystem opens `A` as `a`. */
function caseInsensitiveFs() {
  const probe = mkdtempSync(join(tmpdir(), "ndx-case-probe-"));
  try {
    writeFileSync(join(probe, "A"), "");
    return existsSync(join(probe, "a"));
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

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

  it("never runs it when git fails inside the work tree", () => {
    // A git that cannot answer (dubious ownership exits 128) cannot tell a
    // committed file from the user's, so the file is not read.
    const bin = join(dir, "stub-bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "git"), "#!/bin/sh\nexit 128\n");
    chmodSync(join(bin, "git"), 0o755);
    vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH ?? ""}`);

    discoverClaudeCli(dir);

    expect(existsSync(marker)).toBe(false);
  });

  // On a case-sensitive filesystem n-dx never opens the variant.
  it.skipIf(!caseInsensitiveFs())("never runs it from a committed case variant of the file", () => {
    rmSync(join(dir, ".n-dx.local.json"));
    writeFileSync(join(dir, ".N-DX.local.json"), JSON.stringify({ cli: { claudePath: join(dir, "repo-claude") } }));
    execFileSync("git", ["add", "-f", ".N-DX.local.json"], { cwd: dir, stdio: "ignore" });

    discoverClaudeCli(dir);

    expect(existsSync(marker)).toBe(false);
  });

  it("never runs it from config.local.json reached through a committed symlinked .ndx", () => {
    rmSync(join(dir, ".n-dx.local.json"));
    mkdirSync(join(dir, "cfg"));
    writeFileSync(join(dir, "cfg", "config.local.json"), JSON.stringify({ cli: { claudePath: join(dir, "repo-claude") } }));
    symlinkSync("cfg", join(dir, ".ndx"));
    execFileSync("git", ["add", "-f", "cfg", ".ndx"], { cwd: dir, stdio: "ignore" });

    discoverClaudeCli(dir);

    expect(existsSync(marker)).toBe(false);
  });

  it("runs the user's untracked one", () => {
    const result = discoverClaudeCli(dir);

    expect(existsSync(marker)).toBe(true);
    expect(result).toEqual({ found: true, path: join(dir, "repo-claude") });
  });
});
