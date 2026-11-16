import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPhpGuardsIfNeeded } from "../../../src/agent/lifecycle/shared.js";
import { detectProjectLanguage } from "../../../src/cli/commands/init.js";
import { guardDefaultsForLanguage } from "../../../src/schema/v1.js";
import type { RunRecord } from "../../../src/schema/index.js";
import type { ExecResult } from "../../../src/process/exec.js";

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
    const run = completedRun(["ok.php"]);
    await runPhpGuardsIfNeeded(run, projectDir, php, deps(0, calls));
    expect(run.status).toBe("completed");
    expect(calls).toEqual(["php -l ok.php", "composer validate --no-check-publish"]);
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
});
