/**
 * Files the PHP pack cannot parse cleanly are reported, never fatal. An
 * invented legacy project holds a file with syntax errors, one over the
 * parser's size limit (generated here), a latin-1 file, one with invalid
 * UTF-8 bytes and a clean file; `sv analyze --fast` exits 0, prints one
 * `[php-parse]` line and writes the counts and example paths to imports.json
 * `summary.parseIssues`. A clean PHP project gets zero counts and no notice;
 * a project with no PHP gets no `php` entry.
 * Skips when the PHP grammar is not built.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");
const MIB = 1024 * 1024;

const dirs: string[] = [];

function project(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), "sv-parse-issues-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
  return dir;
}

function analyze(dir: string) {
  const run = spawnSync(process.execPath, [CLI_PATH, "analyze", dir, "--fast"], { encoding: "utf-8", timeout: 90_000 });
  const imports = JSON.parse(readFileSync(join(dir, ".sourcevision", "imports.json"), "utf-8"));
  return { status: run.status, output: `${run.stdout}${run.stderr}`, summary: imports.summary };
}

describe("sv analyze --fast reports PHP files that do not parse cleanly", { timeout: 120_000 }, () => {
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("counts and lists each kind in imports.json, prints one notice line, and exits 0", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const dir = project({
      "index.php": "<?php\nrequire_once 'lib.php';\necho ok();\n",
      "lib.php": "<?php\nfunction ok() { return 1; }\n",
      "broken.php": "<?php\nfunction kept() { return 2; }\n$z = (1 + ;\n",
      "huge.php": "<?php\n" + "$x = 1;\n".repeat(MIB / 8 + 1),
      "latin1.php": Buffer.concat([Buffer.from('<?php\necho "caf'), Buffer.from([0xe9]), Buffer.from('";\n')]),
      "bytes.php": Buffer.concat([Buffer.from("<?php\n// "), Buffer.from([0xff, 0xfe]), Buffer.from("\n")]),
    });

    const { status, output, summary } = analyze(dir);

    expect(status).toBe(0);
    expect(summary.parseIssues).toEqual({
      php: {
        files: 6,
        clean: 2,
        sizeLimitBytes: MIB,
        syntaxErrors: { count: 1, examples: ["broken.php"] },
        oversized: { count: 1, examples: ["huge.php"] },
        unreadable: { count: 0, examples: [] },
        notUtf8: { count: 2, examples: ["bytes.php", "latin1.php"] },
      },
    });
    const lines = output.split("\n").filter((line) => line.includes("[php-parse]"));
    expect(lines).toEqual([
      expect.stringContaining(
        "[php-parse] 1 of 6 files has syntax errors (facts read from the partial tree); 1 over 1 MiB not parsed; " +
          "2 not UTF-8 (parsed with replacement characters)",
      ),
    ]);
  });

  it("writes zero counts, and prints no notice, when every file parses cleanly", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const dir = project({ "index.php": "<?php\n// café\nfunction ok() { return 1; }\n" });

    const { status, output, summary } = analyze(dir);

    expect(status).toBe(0);
    const none = { count: 0, examples: [] };
    expect(summary.parseIssues).toEqual({
      php: { files: 1, clean: 1, sizeLimitBytes: MIB, syntaxErrors: none, oversized: none, unreadable: none, notUtf8: none },
    });
    expect(output).not.toContain("[php-parse]");
  });

  it("writes no php entry for a project with no PHP", () => {
    const dir = project({ "index.ts": "export const ok = 1;\n" });

    const { status, summary } = analyze(dir);

    expect(status).toBe(0);
    expect(summary.parseIssues?.php).toBeUndefined();
  });
});
