import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatRecordCommitPending,
  formatUncommittedWorkRefusal,
  prepareRecoveryPathspecs,
} from "../../src/agent/lifecycle/uncommitted-work-gate.js";
import { commitGitFixtureBaseline, RM_RETRY } from "../helpers/index.js";

const execFile = promisify(execFileCb);

/**
 * Execution coverage for the refusal recovery commands, through real shells.
 *
 * The hazard: a refusal names hostile filenames the agent (or a compromised
 * repo) created, and the operator copies the suggested command into whatever
 * shell they have open. No inline quoting is safe in POSIX sh, PowerShell,
 * AND cmd.exe at once — cmd treats single quotes as literal characters (`&`
 * still splits, spaces still separate) and `%VAR%` expansion cannot be
 * escaped interactively — so hostile names are routed through
 * `--pathspec-from-file` and the command line itself stays shell-inert.
 *
 * These tests prove that end to end: they generate the real messages, extract
 * the exact `git …` lines an operator would copy, execute each through the
 * platform's actual shells, and assert that git received the exact paths and
 * that nothing embedded in a filename executed.
 */

/** Shells an operator on this platform might paste a recovery command into. */
interface ShellRunner {
  name: string;
  /** Execute one copied command line via the real shell, cwd at the repo root. */
  run: (commandLine: string, cwd: string, scratch: string) => Promise<void>;
}

async function runViaScript(
  file: string,
  contents: string,
  argv: [string, string[]],
  cwd: string,
): Promise<void> {
  await writeFile(file, contents, "utf-8");
  await execFile(argv[0], [...argv[1], file], {
    cwd,
    // Prove %VAR% / $VAR in a filename is never expanded: give it a value
    // that would be visible if it were.
    env: { ...process.env, HOSTILE_TEST: "EXPANDED", HOME: process.env.HOME ?? "EXPANDED" },
  });
}

const SHELLS: ShellRunner[] =
  process.platform === "win32"
    ? [
        {
          name: "cmd.exe",
          run: (line, cwd, scratch) =>
            runViaScript(join(scratch, "cmd-step.cmd"), `@${line}\r\n`, ["cmd.exe", ["/d", "/c"]], cwd),
        },
        {
          name: "powershell",
          run: (line, cwd, scratch) =>
            runViaScript(
              join(scratch, "ps-step.ps1"),
              `${line}\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n`,
              ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]],
              cwd,
            ),
        },
      ]
    : [
        {
          name: "sh",
          run: (line, cwd, scratch) =>
            runViaScript(join(scratch, "sh-step.sh"), `set -e\n${line}\n`, ["sh", []], cwd),
        },
      ];

/**
 * Hostile names legal on every platform (Windows forbids `"<>|:*?`). Each one
 * either executes, expands, or splits the command if it ever reaches a shell
 * unprotected. The reviewer's list: spaces, &, %, $, backticks, embedded
 * single quotes.
 */
const HOSTILE_FILES = [
  "src/sp ace.ts",
  "src/a&b.ts",
  "src/$(touch pwned).ts",
  "src/`touch pwned2`.ts",
  "src/%HOSTILE_TEST%.ts",
  "src/$HOME.ts",
  "src/it's a file.ts",
  "src/a;b.ts",
];

/** The exact copyable `git …` lines in a refusal message. */
function commandLines(message: string): string[] {
  return message
    .split("\n")
    .filter((l) => l.trimStart().startsWith("git "))
    .map((l) => l.trim());
}

async function stagedPaths(dir: string): Promise<string[]> {
  const { stdout } = await execFile("git", ["diff", "--cached", "--name-only", "-z"], { cwd: dir });
  return stdout.split("\0").filter(Boolean).sort();
}

function gitSupportsPathspecFromFile(): boolean {
  try {
    const out = execFileSync("git", ["--version"], { encoding: "utf-8" });
    const m = out.match(/(\d+)\.(\d+)/);
    if (!m) return false;
    const [major, minor] = [Number(m[1]), Number(m[2])];
    // git stash push learned --pathspec-from-file in 2.26.
    return major > 2 || (major === 2 && minor >= 26);
  } catch {
    return false;
  }
}

describe.skipIf(!gitSupportsPathspecFromFile())(
  "recovery commands survive real shells verbatim",
  () => {
    let repoDir: string;
    let scratch: string;

    beforeEach(async () => {
      repoDir = await mkdtemp(join(tmpdir(), "recovery-shell-exec-"));
      scratch = await mkdtemp(join(tmpdir(), "recovery-shell-scripts-"));
      await writeFile(join(repoDir, "README.md"), "baseline\n", "utf-8");
      commitGitFixtureBaseline(repoDir);
      await mkdir(join(repoDir, "src"), { recursive: true });
      for (const p of HOSTILE_FILES) {
        await writeFile(join(repoDir, p), "hostile content\n", "utf-8");
      }
    });

    afterEach(async () => {
      await rm(repoDir, { recursive: true, force: true, ...RM_RETRY });
      await rm(scratch, { recursive: true, force: true, ...RM_RETRY });
    });

    function expectNothingExecuted(): void {
      // If any shell had interpreted a filename, one of these would exist —
      // `$(touch pwned)` / backticks execute, `&`/`;` split off a command.
      for (const marker of ["pwned", "pwned2", "EXPANDED"]) {
        expect(existsSync(join(repoDir, marker)), `${marker} was created — a filename executed`).toBe(false);
        expect(existsSync(join(repoDir, "src", marker)), `src/${marker} was created — a filename executed`).toBe(false);
      }
    }

    it.each(SHELLS.map((s) => [s.name, s] as const))(
      "add, commit, and stash land the exact hostile paths via %s",
      async (_name, shell) => {
        const files = await prepareRecoveryPathspecs(repoDir, HOSTILE_FILES);
        expect(files).toBeDefined();

        const refusal = formatUncommittedWorkRefusal(HOSTILE_FILES, new Set(), files);
        const record = formatRecordCommitPending(HOSTILE_FILES, "task-1", "boom", files);
        const addLine = commandLines(refusal).find((l) => l.startsWith("git add"));
        const stashLine = commandLines(refusal).find((l) => l.startsWith("git stash push"));
        const commitLine = commandLines(record).find((l) => l.startsWith("git commit -m"));
        expect(addLine && stashLine && commitLine).toBeTruthy();

        // The copyable lines must be shell-inert in their entirety — that is
        // the property that makes one rendering safe in all three shells.
        for (const line of [addLine!, stashLine!, commitLine!]) {
          expect(line.replace(/"[^"]*"/g, ""), `non-inert command: ${line}`).toMatch(
            /^[A-Za-z0-9._/= -]+$/,
          );
        }

        // 1. `git add` stages exactly the hostile paths — nothing split,
        //    expanded, or dropped by the shell in between.
        await shell.run(addLine!, repoDir, scratch);
        expect(await stagedPaths(repoDir)).toEqual([...HOSTILE_FILES].sort());
        expectNothingExecuted();

        // 2. The record commit lands them, message intact.
        await shell.run(commitLine!, repoDir, scratch);
        const { stdout: committed } = await execFile(
          "git",
          ["show", "--name-only", "--pretty=format:%s", "-z", "HEAD"],
          { cwd: repoDir },
        );
        expect(committed).toContain("chore(prd): commit PRD tree changes (task task-1 completed)");
        for (const p of HOSTILE_FILES) expect(committed).toContain(p);
        expectNothingExecuted();

        // 3. `git stash push` scoops modifications to exactly those paths.
        for (const p of HOSTILE_FILES) {
          await appendFile(join(repoDir, p), "edited\n", "utf-8");
        }
        await shell.run(stashLine!, repoDir, scratch);
        const { stdout: status } = await execFile("git", ["status", "--porcelain"], { cwd: repoDir });
        expect(status.split(/\r?\n/).filter((l) => l.trim() && !l.includes(".hench/"))).toEqual([]);
        const { stdout: stashes } = await execFile("git", ["stash", "list"], { cwd: repoDir });
        expect(stashes.trim()).not.toBe("");
        expectNothingExecuted();
      },
    );
  },
);
