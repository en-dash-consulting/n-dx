/**
 * The Version Packages step stamps shippedIn, and the stamp never blocks a
 * release: `changeset version` failing still fails the script, the stamp
 * failing only prints a warning.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { POSIX_SHELL, describeNeedsPosixShell } from "../helpers/posix-shell.js";

const ROOT = join(import.meta.dirname, "../..");
const script = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")).scripts["version-packages"];
const STAMP_WARNING = "warning: rex release stamp failed; versioning continues";

describe("version-packages", () => {
  it("is the release workflow's version-script", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf-8");
    expect(workflow).toMatch(/^\s*version-script: pnpm run version-packages\s*$/m);
  });

  it("runs changeset version, then the stamp in a fail-open group", () => {
    expect(script).toBe(
      "changeset version && { node packages/rex/dist/cli/index.js release stamp " +
        "\"$(node -p \"require('./packages/core/package.json').version\")\" . || " +
        `echo '${STAMP_WARNING}'; }`,
    );
  });

  // The shell semantics, against a stub `changeset` and a checkout with no rex build.
  describeNeedsPosixShell("under sh", () => {
    function run(changesetExit) {
      const dir = mkdtempSync(join(tmpdir(), "version-packages-"));
      try {
        mkdirSync(join(dir, "bin"));
        mkdirSync(join(dir, "packages", "core"), { recursive: true });
        writeFileSync(join(dir, "packages", "core", "package.json"), JSON.stringify({ version: "9.9.9" }));
        writeFileSync(join(dir, "bin", "changeset"), `#!/bin/sh\nexit ${changesetExit}\n`);
        chmodSync(join(dir, "bin", "changeset"), 0o755);
        const result = spawnSync(POSIX_SHELL, ["-c", script], {
          cwd: dir,
          encoding: "utf-8",
          env: { ...process.env, PATH: `${join(dir, "bin")}${delimiter}${process.env.PATH}` },
        });
        // A shell that never launched would pass the failure case vacuously.
        expect(result.error).toBeUndefined();
        return result;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it("succeeds with a warning when the stamp fails", () => {
      const result = run(0);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(STAMP_WARNING);
    });

    it("fails when changeset version fails, without stamping", () => {
      const result = run(1);
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain(STAMP_WARNING);
    });
  });
});
