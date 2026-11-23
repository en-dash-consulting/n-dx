import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPhpGuardsIfNeeded } from "../../../src/agent/lifecycle/shared.js";
import { detectProjectLanguage } from "../../../src/cli/commands/init.js";
import { guardDefaultsForLanguage } from "../../../src/schema/v1.js";
import type { RunRecord } from "../../../src/schema/index.js";
import type { ExecResult } from "../../../src/process/exec.js";
import { initGitFixtureRepo } from "../../helpers/index.js";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "php-finalize-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

function completedRun(filesChanged: string[]): RunRecord {
  return {
    status: "completed",
    structuredSummary: { filesChanged, counts: { filesChanged: filesChanged.length } },
  } as unknown as RunRecord;
}

const php = { language: "php" as const, guard: guardDefaultsForLanguage("php") };
const deps = (exitCode: number, calls: string[] = []) => ({
  onPath: () => true,
  shellKind: "posix" as const,
  execCommand: async (command: string) => {
    calls.push(command);
    return { exitCode, stdout: exitCode ? "PHP Parse error" : "", stderr: "", launched: true } as ExecResult;
  },
});

describe("runPhpGuardsIfNeeded", () => {
  it("fails a completed PHP run whose changed file does not lint", async () => {
    await writeFile(join(projectDir, "bad.php"), "<?php if (");
    const run = completedRun(["bad.php"]);
    await runPhpGuardsIfNeeded(run, projectDir, php, deps(255));
    expect(run.status).toBe("failed");
    expect(run.error).toContain("php -l bad.php");
  });

  it("leaves a passing PHP run completed", async () => {
    await writeFile(join(projectDir, "ok.php"), "<?php echo 1;");
    await writeFile(join(projectDir, "composer.json"), "{}");
    const calls: string[] = [];
    const run = completedRun(["ok.php", "composer.json"]);
    await runPhpGuardsIfNeeded(run, projectDir, php, deps(0, calls));
    expect(run.status).toBe("completed");
    expect(calls).toEqual(["php -l ok.php", "composer validate --no-check-publish"]);
  });

  // Git reports changed paths from the repository root. A project in a
  // subdirectory resolved them against itself, found nothing, and linted no
  // file at all — a broken PHP change passed.
  it("lints a changed file of a project that is a subdirectory of its repository", async () => {
    await initGitFixtureRepo(projectDir);
    const app = join(projectDir, "app");
    await mkdir(app);
    await writeFile(join(app, "bad.php"), "<?php if (");
    await writeFile(join(projectDir, "outside.php"), "<?php");
    const calls: string[] = [];
    const run = completedRun(["app/bad.php", "outside.php"]);
    await runPhpGuardsIfNeeded(run, app, php, deps(255, calls));
    expect(calls).toEqual(["php -l bad.php"]);
    expect(run.status).toBe("failed");
  });

  it.each([
    ["typescript", "typescript"],
    ["go", "go"],
    ["no language", undefined],
  ] as const)("runs nothing for a %s project", async (_label, language) => {
    await writeFile(join(projectDir, "bad.php"), "<?php if (");
    const calls: string[] = [];
    const run = completedRun(["bad.php"]);
    await runPhpGuardsIfNeeded(run, projectDir, { language, guard: guardDefaultsForLanguage(language) }, deps(255, calls));
    expect(calls).toEqual([]);
    expect(run.status).toBe("completed");
  });

  it("does not touch a run that already failed", async () => {
    await writeFile(join(projectDir, "bad.php"), "<?php if (");
    const calls: string[] = [];
    const run = { ...completedRun(["bad.php"]), status: "failed" } as RunRecord;
    await runPhpGuardsIfNeeded(run, projectDir, php, deps(255, calls));
    expect(calls).toEqual([]);
  });
});

describe("detectProjectLanguage", () => {
  it("reads a root composer.json as php", async () => {
    await writeFile(join(projectDir, "composer.json"), "{}");
    expect(await detectProjectLanguage(projectDir)).toBe("php");
  });

  it("does not read a directory named composer.json as php", async () => {
    await mkdir(join(projectDir, "composer.json"));
    expect(await detectProjectLanguage(projectDir)).toBeUndefined();
  });

  it("keeps go.mod ahead of composer.json", async () => {
    await writeFile(join(projectDir, "composer.json"), "{}");
    await writeFile(join(projectDir, "go.mod"), "module x\n");
    expect(await detectProjectLanguage(projectDir)).toBe("go");
  });

  // Same cases as detectRepoLanguage's in llm-client's repo-trust.test.ts:
  // the two must agree, or trust flags the guard init wrote.
  describe("composer.json beside package.json: source count decides", () => {
    async function touch(...rels: string[]): Promise<void> {
      for (const rel of rels) {
        await mkdir(join(projectDir, rel, ".."), { recursive: true });
        await writeFile(join(projectDir, rel), "");
      }
    }

    it("is php with composer.json and no package.json", async () => {
      await touch("composer.json", "src/a.js", "src/b.ts");
      expect(await detectProjectLanguage(projectDir)).toBe("php");
    });

    it("is the JS/TS default when JS/TS source outnumbers PHP", async () => {
      await touch("composer.json", "package.json", "src/a.js", "src/b.tsx", "src/c.mjs", "api/index.php");
      expect(await detectProjectLanguage(projectDir)).toBeUndefined();
    });

    it("is the JS/TS default on a tie", async () => {
      await touch("composer.json", "package.json", "src/a.ts", "api/index.php");
      expect(await detectProjectLanguage(projectDir)).toBeUndefined();
    });

    it("is php for a Laravel-shaped checkout", async () => {
      await touch(
        "composer.json", "package.json", "artisan",
        "app/Models/User.php", "app/Http/Controllers/Controller.php", "routes/web.php",
        "resources/views/home.phtml", "resources/js/app.js",
      );
      expect(await detectProjectLanguage(projectDir)).toBe("php");
    });

    it("counts nothing under vendor/, node_modules/ or dot-directories", async () => {
      await touch(
        "composer.json", "package.json", "src/a.ts", "src/b.ts", "app/x.php",
        "vendor/pkg/a.php", "vendor/pkg/b.php", "vendor/pkg/c.php",
        "node_modules/x/a.js", "build/a.js", ".cache/a.js",
      );
      expect(await detectProjectLanguage(projectDir)).toBeUndefined();
      await touch(
        "app/y.php", "app/z.php",
        "node_modules/x/b.js", "node_modules/x/c.js", "node_modules/x/d.js", "dist/a.js", ".git/a.js",
      );
      expect(await detectProjectLanguage(projectDir)).toBe("php");
    });

    it("does not count minified JavaScript", async () => {
      await touch("composer.json", "package.json", "plugin.php", "assets/jquery.min.js", "assets/select2.min.js");
      expect(await detectProjectLanguage(projectDir)).toBe("php");
    });

    it("stops at a bounded depth", async () => {
      await touch("composer.json", "package.json", "app/a.php", "a/b/c/d/e/x.js", "a/b/c/d/e/y.js");
      expect(await detectProjectLanguage(projectDir)).toBe("php");
    });

    it("still gives go.mod precedence", async () => {
      await touch("go.mod", "composer.json", "package.json", "app/a.php", "app/b.php");
      expect(await detectProjectLanguage(projectDir)).toBe("go");
    });
  });
});
