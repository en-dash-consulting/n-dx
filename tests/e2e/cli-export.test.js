/**
 * `ndx export --deploy=github` is a remote write: it force-pushes the export to
 * `origin/n-dx-dashboard`. It must not happen without the operator seeing what
 * is about to be published. Non-TTY runs — CI, a dashboard-spawned child, a
 * script — have no one to ask, so they need `--yes`; without it the command
 * prints the manifest and stops before writing or pushing anything.
 *
 * These tests stop at the gate on purpose: the full export needs a built
 * viewer, which an e2e fixture should not depend on.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_PATH,
  DEFAULT_TIMEOUT,
  createTmpDir,
  removeTmpDir,
  setupSourcevisionDir,
} from "./e2e-helpers.js";

const REMOTE = "https://example.invalid/acme/widgets.git";

function ndx(args, cwd) {
  return spawnSync("node", [CLI_PATH, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: DEFAULT_TIMEOUT,
    // stdin is a pipe, not a TTY — the shape of every unattended invocation.
    stdio: ["pipe", "pipe", "pipe"],
  });
}

describe("ndx export", () => {
  let dir;

  beforeEach(async () => {
    dir = await createTmpDir("ndx-export-e2e-");
    await setupSourcevisionDir(dir);
    await mkdir(join(dir, ".rex", "prd_tree", "an-epic"), { recursive: true });
    await writeFile(join(dir, ".rex", "prd_tree", "an-epic", "index.md"), "---\nid: e1\ntitle: An epic\nlevel: epic\nstatus: pending\n---\n");
    await mkdir(join(dir, ".hench", "runs"), { recursive: true });
    await writeFile(join(dir, ".hench", "runs", "run-1.json"), JSON.stringify({ id: "run-1", startedAt: "2026-01-01T00:00:00.000Z", status: "completed" }));
    const git = (a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git(["init", "-q"]);
    git(["remote", "add", "origin", REMOTE]);
  });

  afterEach(async () => {
    await removeTmpDir(dir);
  });

  describe("--deploy=github confirmation gate", () => {
    it("refuses without --yes when stdin is not a TTY, and pushes nothing", () => {
      const result = ndx(["export", "--deploy=github", dir], dir);

      expect(result.status).toBe(1);
      // The manifest names what would have been published.
      expect(result.stderr).toContain(REMOTE);
      expect(result.stderr).toContain("n-dx-dashboard");
      expect(result.stderr).toContain("1 hench run");
      expect(result.stderr).toMatch(/transcripts?:\s+(excluded|not included)/i);
      expect(result.stderr).toContain("--yes");
      // Nothing was written or pushed.
      expect(existsSync(join(dir, "ndx-export"))).toBe(false);
      const branches = execFileSync("git", ["branch", "--list", "n-dx-dashboard"], { cwd: dir, encoding: "utf-8" });
      expect(branches.trim()).toBe("");
    });

    it("passes the gate with --yes", () => {
      const result = ndx(["export", "--deploy=github", "--yes", dir], dir);

      // The export itself may still fail later in this fixture (no built
      // viewer, unreachable remote) — what matters is that the refusal did not
      // fire and the export started.
      expect(result.stderr).not.toContain("requires confirmation");
      expect(result.stdout).toContain("[export] generating static dashboard");
    });
  });

  describe("--help", () => {
    it("documents the transcript and confirmation flags and what is published", () => {
      const result = ndx(["export", "--help"], dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("--include-transcripts");
      expect(result.stdout).toContain("--yes");
      expect(result.stdout).toMatch(/not published/i);
    });
  });

  describe("published run records", () => {
    // A run record whose free-text fields all carry the same sentinel. The
    // published files are written in step 3 of the export, before the viewer
    // assets are needed, so this assertion holds whether or not the viewer is
    // built in the checkout running the test.
    const SENTINEL = "sk-ant-api03-LEAKED-FROM-DOTENV";

    async function writeLeakyRun() {
      await writeFile(join(dir, ".hench", "runs", "run-1.json"), JSON.stringify({
        id: "run-1",
        taskId: "t1",
        taskTitle: "Wire the thing",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "failed",
        turns: 2,
        error: `ENOENT while reading ${SENTINEL}`,
        tokenUsage: { input: 1, output: 1 },
        structuredSummary: {
          counts: { filesRead: 1, filesChanged: 1, commandsExecuted: 1, testsRun: 1, toolCallsTotal: 2 },
          commandsExecuted: [{ command: `curl -H "Authorization: Bearer ${SENTINEL}" https://x`, exitStatus: "ok", durationMs: 1 }],
          testsRun: [{ command: `pnpm test # ${SENTINEL}`, passed: false, durationMs: 1 }],
          postRunTests: { ran: true, passed: false, output: `env dump: KEY=${SENTINEL}`, error: `spawn: ${SENTINEL}`, targetedFiles: [] },
        },
        testGate: {
          ran: true,
          passed: false,
          packages: [{ name: "packages/hench", passed: false, failureOutput: `AssertionError: ${SENTINEL}` }],
          error: `vitest: ${SENTINEL}`,
        },
        dependencyAudit: { ran: false, skipped: false, error: `audit: ${SENTINEL}`, commands: { audit: { command: "pnpm audit", exitCode: null, ran: false, error: `spawn ENOENT ${SENTINEL}` } } },
        cleanupTransformations: { ran: true, appliedCount: 0, rolledBackCount: 1, batches: [{ transformations: [], validated: false, rolledBack: true, error: `tsc: ${SENTINEL}` }], error: `cleanup: ${SENTINEL}` },
        diagnostics: { tokenDiagnosticStatus: "complete", parseMode: "stream-json", notes: [`codex_usage_missing: ${SENTINEL}`] },
        toolCalls: [{ turn: 1, tool: "read_file", input: { path: ".env" }, output: SENTINEL, durationMs: 1 }],
      }));
    }

    /** Fail on the CLI's own error rather than on a missing output file. */
    function expectExported(result) {
      expect(result.status, `ndx export exited ${result.status}\n${result.stderr}`).toBe(0);
    }

    it("strip every free-text field from the per-run file and the index", async () => {
      await writeLeakyRun();
      expectExported(ndx(["export", dir], dir));

      const outDir = join(dir, "ndx-export", "api", "hench");
      const detail = await readFile(join(outDir, "runs", "run-1.json"), "utf-8");
      const index = await readFile(join(outDir, "runs.json"), "utf-8");

      expect(detail).not.toContain(SENTINEL);
      expect(index).not.toContain(SENTINEL);

      // …and the run is still there, summarised, not silently dropped.
      const parsed = JSON.parse(index);
      expect(parsed.total).toBe(1);
      expect(parsed.runs[0].id).toBe("run-1");
      expect(parsed.runs[0].status).toBe("failed");
      expect(parsed.runs[0].transcriptOmitted).toBe(true);
      expect(JSON.parse(detail).structuredSummary.counts.toolCallsTotal).toBe(2);
    });

    it("publish the full record under --include-transcripts", async () => {
      await writeLeakyRun();
      expectExported(ndx(["export", "--include-transcripts", dir], dir));

      const outDir = join(dir, "ndx-export", "api", "hench");
      expect(await readFile(join(outDir, "runs", "run-1.json"), "utf-8")).toContain(SENTINEL);
    });
  });

  describe("output directory hygiene", () => {
    it("gitignores the default out-dir when export runs inside the project", async () => {
      // Even a run that stops at the gate must not leave `ndx-export/`
      // committable — the gitignore entry is written before any output is.
      ndx(["export", "--deploy=github", "--yes", dir], dir);
      const ignore = await readFile(join(dir, ".gitignore"), "utf-8").catch(() => "");
      expect(ignore.split("\n")).toContain("ndx-export/");
    });
  });
});
