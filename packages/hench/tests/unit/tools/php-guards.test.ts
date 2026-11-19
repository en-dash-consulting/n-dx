import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPOSER_VALIDATE_COMMAND,
  detectPhpunitCommand,
  planPhpGuards,
  projectRelativePaths,
  quotePathForShell,
  runPhpGuards,
} from "../../../src/tools/php-guards.js";
import { resolveTestCommand } from "../../../src/tools/test-command-resolver.js";
import type { ExecOptions, ExecResult } from "../../../src/process/exec.js";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "php-guards-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

async function put(rel: string, body = ""): Promise<void> {
  await mkdir(join(projectDir, rel, ".."), { recursive: true });
  await writeFile(join(projectDir, rel), body);
}

const allOnPath = () => true;
const posix = { onPath: allOnPath, shellKind: "posix" as const };

function result(exitCode: number | null, stdout = "", stderr = ""): ExecResult {
  return { exitCode, stdout, stderr, launched: true } as ExecResult;
}

describe("detectPhpunitCommand", () => {
  it.each(["phpunit.xml", "phpunit.xml.dist"])("returns vendor/bin/phpunit with %s and the binary", async (config) => {
    await put(config, "<phpunit/>");
    await put("vendor/bin/phpunit", "#!/usr/bin/env php");
    expect(await detectPhpunitCommand(projectDir)).toBe("vendor/bin/phpunit");
  });

  it("returns nothing without a PHPUnit config", async () => {
    await put("vendor/bin/phpunit");
    expect(await detectPhpunitCommand(projectDir)).toBeUndefined();
  });

  it("returns nothing when PHPUnit is not installed: n-dx installs nothing", async () => {
    await put("phpunit.xml.dist");
    expect(await detectPhpunitCommand(projectDir)).toBeUndefined();
  });

  it("is what the test gate auto-detects for a PHP project", async () => {
    await put("composer.json", "{}");
    await put("phpunit.xml");
    await put("vendor/bin/phpunit");
    const resolved = await resolveTestCommand({ projectDir, henchDir: join(projectDir, ".hench") });
    expect(resolved).toMatchObject({ command: "vendor/bin/phpunit", source: "auto-detect" });
  });
});

describe("planPhpGuards", () => {
  it("lints each changed PHP file that still exists, and validates a changed composer.json", async () => {
    await put("composer.json", "{}");
    await put("src/A.php");
    await put("views/page.phtml");
    await put("lib/legacy.INC");
    await put("README.md");
    const plan = await planPhpGuards(
      projectDir,
      ["src/A.php", "views/page.phtml", "lib/legacy.INC", "README.md", "src/Deleted.php", "composer.json"],
      posix,
    );
    expect(plan.checks.map((c) => c.command)).toEqual([
      "php -l ./src/A.php",
      "php -l ./views/page.phtml",
      "php -l ./lib/legacy.INC",
      COMPOSER_VALIDATE_COMMAND,
    ]);
    expect(plan.skipped).toEqual([]);
    expect(plan.errors).toEqual([]);
  });

  it("runs no composer check without composer.json", async () => {
    await put("index.php");
    const plan = await planPhpGuards(projectDir, ["index.php"], posix);
    expect(plan.checks.map((c) => c.kind)).toEqual(["php-lint"]);
  });

  it.each(["composer.json", "composer.lock"])("validates composer.json when %s changed and no PHP file did", async (changed) => {
    await put("composer.json", "{}");
    const plan = await planPhpGuards(projectDir, [changed], posix);
    expect(plan.checks.map((c) => c.command)).toEqual([COMPOSER_VALIDATE_COMMAND]);
  });

  // `composer validate` checks the lock too: a lock stale before the run would
  // fail every run, and the agent cannot refresh it offline.
  it("does not validate composer.json when the change touched neither Composer file", async () => {
    await put("composer.json", "{}");
    await put("index.php");
    const plan = await planPhpGuards(projectDir, ["index.php", "lib/composer.json"], posix);
    expect(plan.checks.map((c) => c.kind)).toEqual(["php-lint"]);
  });

  it("skips a check whose tool is not on PATH instead of failing", async () => {
    await put("composer.json", "{}");
    await put("index.php");
    const plan = await planPhpGuards(projectDir, ["index.php", "composer.json"], { onPath: () => false, shellKind: "posix" });
    expect(plan.checks).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped[0]).toContain("php is not on PATH");
    expect(plan.skipped[1]).toContain("composer is not on PATH");
  });

  it("plans nothing for a change with no PHP file and no composer.json", async () => {
    await put("README.md");
    expect(await planPhpGuards(projectDir, ["README.md"], posix)).toEqual({ checks: [], skipped: [], errors: [] });
  });
});

describe("projectRelativePaths", () => {
  it("strips the project's prefix and drops paths outside it", () => {
    expect(projectRelativePaths(["app/src/A.php", "other/B.php", "app/composer.json"], "app/"))
      .toEqual(["src/A.php", "composer.json"]);
  });

  it("returns repo-root paths unchanged at the root", () => {
    expect(projectRelativePaths(["src/A.php"], "")).toEqual(["src/A.php"]);
  });
});

describe("quotePathForShell", () => {
  it("leaves ordinary paths bare and quotes the rest for sh", () => {
    expect(quotePathForShell("src/A.php", "posix")).toBe("./src/A.php");
    expect(quotePathForShell("my dir/it's.php", "posix")).toBe("'./my dir/it'\\''s.php'");
    expect(quotePathForShell("a;rm -rf x.php", "posix")).toBe("'./a;rm -rf x.php'");
  });

  // `-zx.php` matches SHELL_SAFE_PATH; bare, php would read it as options.
  it.each(["posix", "cmd"] as const)("never passes a relative path as an option (%s)", (shellKind) => {
    expect(quotePathForShell("-zx.php", shellKind)).toBe("./-zx.php");
    expect(quotePathForShell("./a.php", shellKind)).toBe("./a.php");
  });

  it("lints a changed root file named -zx.php as ./-zx.php", async () => {
    await put("-zx.php");
    const plan = await planPhpGuards(projectDir, ["-zx.php"], posix);
    expect(plan.checks.map((c) => c.command)).toEqual(["php -l ./-zx.php"]);
  });

  it("refuses what cmd.exe would expand inside quotes", () => {
    expect(quotePathForShell("my dir/a.php", "cmd")).toBe('"./my dir/a.php"');
    expect(quotePathForShell("%PATH%.php", "cmd")).toBeUndefined();
  });

  it("fails the guard for a file it cannot lint safely, rather than skipping it", async () => {
    await put("50%.php");
    const plan = await planPhpGuards(projectDir, ["50%.php"], { onPath: allOnPath, shellKind: "cmd" });
    expect(plan.checks).toEqual([]);
    expect(plan.errors).toHaveLength(1);
  });
});

describe("runPhpGuards", () => {
  it("passes when every check exits 0, with the guard's timeout", async () => {
    await put("composer.json", "{}");
    await put("index.php");
    const calls: Array<[string, ExecOptions]> = [];
    const r = await runPhpGuards({
      projectDir,
      filesChanged: ["index.php", "composer.json"],
      timeout: 1234,
      ...posix,
      execCommand: async (command, opts) => { calls.push([command, opts]); return result(0); },
    });
    expect(r.passed).toBe(true);
    expect(calls.map(([c]) => c)).toEqual(["php -l ./index.php", COMPOSER_VALIDATE_COMMAND]);
    expect(calls.every(([, o]) => o.timeout === 1234 && o.cwd === projectDir)).toBe(true);
  });

  it("fails on a lint error and keeps the output", async () => {
    await put("bad.php");
    const r = await runPhpGuards({
      projectDir,
      filesChanged: ["bad.php"],
      timeout: 1000,
      ...posix,
      execCommand: async () => result(255, "PHP Parse error: syntax error in bad.php on line 3"),
    });
    expect(r.passed).toBe(false);
    expect(r.results[0]).toMatchObject({ command: "php -l ./bad.php", passed: false });
    expect(r.results[0].output).toContain("Parse error");
  });

  it("fails a check that timed out", async () => {
    await put("slow.php");
    const r = await runPhpGuards({
      projectDir,
      filesChanged: ["slow.php"],
      timeout: 5,
      ...posix,
      execCommand: async () => result(null),
    });
    expect(r.passed).toBe(false);
    expect(r.results[0].output).toContain("timed out");
  });
});
