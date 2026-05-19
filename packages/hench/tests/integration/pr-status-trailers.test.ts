import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { extractStatusTrailers, formatPrStatusSection } from "../../src/tools/pr-status-trailers.js";

const execAsync = promisify(execCb);

/**
 * Integration tests for extractStatusTrailers and formatPrStatusSection.
 *
 * Creates a fixture git branch with commits containing N-DX-Status trailers
 * and verifies that the extractor surfaces the correct entries.
 *
 * The trailer format used here mirrors exactly what `performCommitPromptIfNeeded`
 * writes to `.hench-commit-msg.txt` before calling `git commit -F`.
 */

async function setupGitRepo(dir: string): Promise<void> {
  await execAsync("git init", { cwd: dir });
  await execAsync("git config user.email test@test.com", { cwd: dir });
  await execAsync("git config user.name Test", { cwd: dir });
}

async function makeCommit(dir: string, subject: string, body?: string): Promise<string> {
  await writeFile(join(dir, "file.txt"), `${subject}\n`, "utf-8");
  await execAsync("git add .", { cwd: dir });
  const message = body ? `${subject}\n\n${body}` : subject;
  // Use a temp file for the commit message to reliably handle multiline strings
  // and special characters (→) without shell escaping issues.
  const msgDir = await mkdtemp(join(tmpdir(), "hench-msg-"));
  const msgFile = join(msgDir, "COMMIT_EDITMSG");
  await writeFile(msgFile, message, "utf-8");
  await execAsync(`git commit -F "${msgFile}"`, { cwd: dir });
  await rm(msgDir, { recursive: true, force: true });
  const { stdout } = await execAsync("git rev-parse HEAD", { cwd: dir });
  return stdout.trim();
}

/** Create a commit whose message has an N-DX-Status trailer. */
async function makeStatusCommit(
  dir: string,
  subject: string,
  itemId: string,
  fromStatus: string,
  toStatus: string,
): Promise<string> {
  const trailerLine = `N-DX-Status: ${itemId} ${fromStatus} → ${toStatus}`;
  const body = `\n${trailerLine}`;
  return makeCommit(dir, subject, body);
}

describe("extractStatusTrailers", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-pr-trailers-"));
    await setupGitRepo(projectDir);
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("extracts a single N-DX-Status trailer from a commit", async () => {
    const sha = await makeStatusCommit(
      projectDir,
      "feat: complete task",
      "abc-123",
      "in_progress",
      "completed",
    );

    const trailers = await extractStatusTrailers(projectDir, sha);
    expect(trailers).toHaveLength(1);
    expect(trailers[0]).toEqual({
      commitHash: sha,
      itemId: "abc-123",
      fromStatus: "in_progress",
      toStatus: "completed",
    });
  });

  it("extracts trailers from multiple commits in a range", async () => {
    // Create a base commit (the range start)
    const baseSha = await makeCommit(projectDir, "chore: initial");

    // Create a branch with two status-changing commits
    const sha1 = await makeStatusCommit(
      projectDir, "feat: task one", "task-001", "in_progress", "completed",
    );
    const sha2 = await makeStatusCommit(
      projectDir, "feat: task two", "task-002", "pending", "completed",
    );

    const range = `${baseSha}..HEAD`;
    const trailers = await extractStatusTrailers(projectDir, range);

    // Should be ordered oldest → newest
    expect(trailers).toHaveLength(2);
    expect(trailers[0].commitHash).toBe(sha1);
    expect(trailers[0].itemId).toBe("task-001");
    expect(trailers[0].fromStatus).toBe("in_progress");
    expect(trailers[0].toStatus).toBe("completed");

    expect(trailers[1].commitHash).toBe(sha2);
    expect(trailers[1].itemId).toBe("task-002");
    expect(trailers[1].fromStatus).toBe("pending");
    expect(trailers[1].toStatus).toBe("completed");
  });

  it("skips commits with no N-DX-Status trailer", async () => {
    const baseSha = await makeCommit(projectDir, "chore: initial");
    await makeCommit(projectDir, "docs: update readme");
    await makeStatusCommit(projectDir, "feat: close it", "xyz-999", "in_progress", "completed");

    const trailers = await extractStatusTrailers(projectDir, `${baseSha}..HEAD`);
    expect(trailers).toHaveLength(1);
    expect(trailers[0].itemId).toBe("xyz-999");
  });

  it("returns empty array when range has no status trailers", async () => {
    await makeCommit(projectDir, "chore: initial");
    await makeCommit(projectDir, "fix: typo");
    const trailers = await extractStatusTrailers(projectDir, "HEAD");
    expect(trailers).toHaveLength(0);
  });

  it("returns empty array for an invalid range without throwing", async () => {
    const trailers = await extractStatusTrailers(projectDir, "nonexistent-branch..HEAD");
    expect(trailers).toHaveLength(0);
  });

  it("handles a commit with multiple trailers (edge case)", async () => {
    await writeFile(join(projectDir, "file.txt"), "content\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });

    // Craft a commit with two N-DX-Status trailers (unusual but valid)
    const msg = [
      "feat: close two tasks at once",
      "",
      "N-DX-Status: task-a in_progress → completed",
      "N-DX-Status: task-b pending → completed",
    ].join("\n");

    const { stdout: msgFile } = await execAsync("mktemp", { cwd: projectDir });
    const tempPath = msgFile.trim();
    await writeFile(tempPath, msg, "utf-8");
    await execAsync(`git commit -F "${tempPath}"`, { cwd: projectDir });
    const { stdout: headOut } = await execAsync("git rev-parse HEAD", { cwd: projectDir });
    const sha = headOut.trim();

    const trailers = await extractStatusTrailers(projectDir, sha);
    expect(trailers).toHaveLength(2);
    expect(trailers[0].itemId).toBe("task-a");
    expect(trailers[1].itemId).toBe("task-b");
  });

  it("trailer is parseable by git interpret-trailers --parse", async () => {
    // Verify that the N-DX-Status trailer format is recognized by git's own
    // trailer parser, satisfying the round-trip requirement in the AC.
    const sha = await makeStatusCommit(
      projectDir,
      "feat: verify trailer format",
      "uuid-test-1",
      "in_progress",
      "completed",
    );

    // git interpret-trailers --parse reads the commit message body and emits
    // recognized key=value pairs, one per line.
    const { stdout } = await execAsync(
      `git log -1 --format=%B ${sha} | git interpret-trailers --parse`,
      { cwd: projectDir },
    );

    // The output should contain the N-DX-Status trailer line
    expect(stdout).toMatch(/N-DX-Status:\s+uuid-test-1\s+in_progress\s+→\s+completed/);
  });

  it("trailer round-trips through git log --format='%(trailers)'", async () => {
    const sha = await makeStatusCommit(
      projectDir,
      "feat: round-trip test",
      "round-trip-id",
      "pending",
      "completed",
    );

    const { stdout } = await execAsync(
      `git log -1 --format='%(trailers)' ${sha}`,
      { cwd: projectDir },
    );

    expect(stdout).toContain("N-DX-Status: round-trip-id pending → completed");
  });
});

describe("formatPrStatusSection", () => {
  it("returns a markdown section listing closed items", () => {
    const trailers = [
      { commitHash: "abc1234", itemId: "task-1", fromStatus: "in_progress", toStatus: "completed" },
      { commitHash: "def5678", itemId: "task-2", fromStatus: "pending", toStatus: "completed" },
    ];

    const section = formatPrStatusSection(trailers);
    expect(section).toContain("## Closed PRD items");
    expect(section).toContain("task-1");
    expect(section).toContain("abc1234");
    expect(section).toContain("task-2");
    expect(section).toContain("def5678");
  });

  it("returns empty string when no items were completed", () => {
    const trailers = [
      { commitHash: "abc1234", itemId: "task-1", fromStatus: "pending", toStatus: "in_progress" },
    ];
    expect(formatPrStatusSection(trailers)).toBe("");
  });

  it("returns empty string for an empty trailer list", () => {
    expect(formatPrStatusSection([])).toBe("");
  });

  it("excludes non-completed transitions", () => {
    const trailers = [
      { commitHash: "abc1234", itemId: "task-1", fromStatus: "pending", toStatus: "in_progress" },
      { commitHash: "def5678", itemId: "task-2", fromStatus: "in_progress", toStatus: "completed" },
    ];
    const section = formatPrStatusSection(trailers);
    expect(section).toContain("task-2");
    expect(section).not.toContain("task-1");
  });
});
