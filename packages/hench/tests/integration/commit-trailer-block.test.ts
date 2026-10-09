/**
 * The work commit's trailers land in one final trailer block.
 *
 * git parses trailers from the message's last paragraph only, so a trailer
 * separated from the others by a blank line is body text to every reader —
 * rex's `computeChangeCommits` asks for `%(trailers:key=N-DX-Item)` and never
 * sees it. Every assertion here goes through git's own parser
 * ({@link gitCommitTrailers}, `%(trailers:...)`), never a regex over `%B`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { initConfig } from "../../src/store/config.js";
import { performCommitPromptIfNeeded } from "../../src/agent/lifecycle/shared.js";
import { buildCompletedRun, gitCommitTrailers, initGitFixtureRepoSync, RM_RETRY } from "../helpers/index.js";

const TASK_ID = "task-1";
const HENCH_COAUTHOR = "En Dash's n-dx <n-dx@endash.us>";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

/** A store whose task moves in_progress → completed, so N-DX-Status is written too. */
function statusTrackingStore() {
  let status = "in_progress";
  return {
    getItem: vi.fn(async (id: string) => (id === TASK_ID ? { status } : null)),
    updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
      if (id === TASK_ID && updates.status) status = String(updates.status);
    }),
    appendLog: vi.fn(async () => {}),
    loadDocument: vi.fn(async () => ({ items: [{ id: TASK_ID, status }] })),
  };
}

describe("work commit — one final trailer block", () => {
  let projectDir: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-trailer-block-"));
    await initConfig(join(projectDir, ".hench"));
    await mkdir(join(projectDir, ".hench", "runs"), { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    initGitFixtureRepoSync(projectDir);
    await writeFile(join(projectDir, "src.ts"), "export const x = 1;\n", "utf-8");
    git(projectDir, "add", ".");
    git(projectDir, "commit", "-m", "initial");
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  async function commitWithMessage(message: string, store?: unknown): Promise<void> {
    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    git(projectDir, "add", "src.ts");
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), message, "utf-8");
    await performCommitPromptIfNeeded(
      buildCompletedRun({
        taskId: TASK_ID,
        vendor: "claude",
        model: "test-model",
        turns: 3,
        toolCalls: [],
        tokenUsage: { input: 100, output: 50 },
        turnTokenUsage: [],
      }),
      projectDir,
      /* autoCommit */ false,
      /* yes */ false,
      /* autonomous */ true,
      store as never,
      TASK_ID,
    );
    expect(git(projectDir, "log", "-1", "--format=%s").trim()).toBe("feat: update x");
  }

  const messages: Array<[string, string]> = [
    ["subject only, no trailing newline", "feat: update x"],
    ["subject only, trailing newline", "feat: update x\n"],
    ["subject and body, trailing blank lines", "feat: update x\n\nWhy it changed.\n\n"],
    ["agent's own trailer, no trailing newline", "feat: update x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"],
    ["agent's own trailer, trailing newline", "feat: update x\n\nBody.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n"],
    [
      "agent's trailers split by a blank line",
      "feat: update x\n\nN-DX-Item: task-1\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n",
    ],
    [
      "CRLF line endings, agent's own trailer",
      "feat: update x\r\n\r\nCo-Authored-By: Claude <noreply@anthropic.com>\r\n",
    ],
  ];

  for (const [label, message] of messages) {
    it(`git reads N-DX-Item from the final block — ${label}`, async () => {
      await commitWithMessage(message, statusTrackingStore());

      expect(
        git(projectDir, "log", "-1", "--format=%(trailers:key=N-DX-Item,valueonly)").trim(),
      ).toBe(TASK_ID);

      const keys = gitCommitTrailers(projectDir).map(([key]) => key);
      for (const key of ["N-DX-Status", "N-DX", "N-DX-Item", "Co-Authored-By"]) {
        expect(keys).toContain(key);
      }
      expect(gitCommitTrailers(projectDir)).toContainEqual(["Co-Authored-By", HENCH_COAUTHOR]);
    });
  }

  it("keeps the agent's own trailers in the same block as hench's", async () => {
    await commitWithMessage("feat: update x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n");

    const trailers = gitCommitTrailers(projectDir);
    expect(trailers).toContainEqual(["Co-Authored-By", "Claude <noreply@anthropic.com>"]);
    expect(trailers).toContainEqual(["N-DX-Item", TASK_ID]);
    expect(trailers).toContainEqual(["Co-Authored-By", HENCH_COAUTHOR]);
  });

  it("does not repeat an N-DX-Item the agent already wrote in the final block", async () => {
    await commitWithMessage("feat: update x\n\nN-DX-Item: task-1\n");

    const items = gitCommitTrailers(projectDir).filter(([key]) => key === "N-DX-Item");
    expect(items).toEqual([["N-DX-Item", TASK_ID]]);
  });

  it("keeps a CRLF agent trailer and does not repeat hench's trailer already in it", async () => {
    await commitWithMessage(
      `feat: update x\r\n\r\nCo-Authored-By: Claude <noreply@anthropic.com>\r\nN-DX-Item: ${TASK_ID}\r\n`,
    );

    const trailers = gitCommitTrailers(projectDir);
    expect(trailers).toContainEqual(["Co-Authored-By", "Claude <noreply@anthropic.com>"]);
    expect(trailers.filter(([key]) => key === "N-DX-Item")).toEqual([["N-DX-Item", TASK_ID]]);
    // git parses only the final block, so a repeat stranded in the body is
    // invisible to %(trailers); count over the whole message.
    const raw = git(projectDir, "log", "-1", "--format=%B");
    expect(raw.split(`N-DX-Item: ${TASK_ID}`).length - 1).toBe(1);
  });
});
