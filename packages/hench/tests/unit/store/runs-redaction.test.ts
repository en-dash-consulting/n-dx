import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRun, saveRun } from "../../../src/store/runs.js";
import { persistRunLog } from "../../../src/store/run-log.js";
import type { RunRecord } from "../../../src/schema/v1.js";

const GITHUB = "ghp_" + "q".repeat(36);
const KEY_BLOCK = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";

let henchDir: string;
let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "hench-redact-"));
  henchDir = join(projectDir, ".hench");
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function runWithSecrets(): RunRecord {
  return {
    id: "run-redact-1",
    taskId: "task-1",
    taskTitle: "Read the environment",
    startedAt: new Date().toISOString(),
    status: "completed",
    turns: 2,
    tokenUsage: { input: 1234, output: 5678 },
    turnTokenUsage: [],
    toolCalls: [
      {
        turn: 1,
        tool: "run_command",
        input: { command: "cat .env" },
        output: `GITHUB_TOKEN=${GITHUB}\nDATABASE_URL=postgres://app:pw12345678@db/x\nPORT=3000`,
        durationMs: 5,
      },
      { turn: 2, tool: "read_file", input: { path: "deploy.pem" }, output: KEY_BLOCK, durationMs: 1 },
    ],
    model: "sonnet",
    summary: `Found the token ${GITHUB} in .env and moved on.`,
  };
}

describe("run records are scrubbed before they reach disk", () => {
  it("saveRun writes redacted text, loadRun reads it back, and the in-memory record is untouched", async () => {
    const run = runWithSecrets();
    await saveRun(henchDir, run);

    const onDisk = readFileSync(join(henchDir, "runs", `${run.id}.json`), "utf-8");
    expect(onDisk).not.toContain(GITHUB);
    expect(onDisk).not.toContain("pw12345678");
    expect(onDisk).not.toContain("BEGIN PRIVATE KEY");
    expect(onDisk).toContain("PORT=3000");
    expect(onDisk).toContain('"input": 1234');

    const loaded = await loadRun(henchDir, run.id);
    expect(loaded.toolCalls[0].output).toContain("GITHUB_TOKEN=[redacted:token]");
    expect(loaded.toolCalls[0].output).toContain("postgres://app:[redacted:password]@db/x");
    expect(loaded.toolCalls[1].output).toBe("[redacted:private-key]");
    expect(loaded.summary).toContain("[redacted:token]");
    expect(loaded.tokenUsage).toEqual({ input: 1234, output: 5678 });

    // The agent keeps working from the unredacted record; only disk is scrubbed.
    expect(run.toolCalls[0].output).toContain(GITHUB);
  });

  it("persistRunLog scrubs each line of the terminal log", async () => {
    const path = await persistRunLog(projectDir, "run-redact-1", "2026-10-01T10:00:00.000Z", [
      "starting",
      `export NPM_TOKEN=${"npm_" + "x".repeat(36)}`,
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      "done",
    ]);
    const log = readFileSync(path, "utf-8");
    expect(log).toBe("starting\nexport NPM_TOKEN=[redacted:token]\nAuthorization: Bearer [redacted:token]\ndone\n");
  });
});
