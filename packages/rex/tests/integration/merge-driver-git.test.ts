/**
 * Repo-level test of the rex-prd git merge driver: two branches diverge on the
 * same PRD item file and merge cleanly through `rex merge-driver`.
 *
 * Spawns real git with the driver registered the way `ndx init` will register
 * it, pointing at the built CLI (dist/) because git launches the driver as a
 * separate process. Requires `pnpm build` to have run — CI builds before
 * testing, and the check below fails with that instruction rather than a
 * misleading merge failure.
 *
 * @see packages/rex/src/cli/commands/merge-driver.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const CLI_DIST = resolve(import.meta.dirname, "../../dist/cli/index.js");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

const ITEM_PATH = ".rex/prd_tree/sample-task-aaaa11.md";

function itemDoc(overrides: { status?: string; tags?: string[]; lastModified?: string }): string {
  const lines = [
    "---",
    'id: "aaaa1111-0000-0000-0000-000000000000"',
    'level: "task"',
    'title: "Sample Task"',
    `status: ${JSON.stringify(overrides.status ?? "pending")}`,
  ];
  if (overrides.tags) {
    lines.push("tags:");
    for (const t of overrides.tags) lines.push(`  - ${JSON.stringify(t)}`);
  }
  if (overrides.lastModified) lines.push(`lastModified: ${JSON.stringify(overrides.lastModified)}`);
  lines.push("---", "");
  return lines.join("\n");
}

describe("rex-prd merge driver in a real repository", () => {
  let repo: string;

  beforeEach(async () => {
    await access(CLI_DIST).catch(() => {
      throw new Error(`Built CLI not found at ${CLI_DIST} — run 'pnpm build' before this test.`);
    });

    repo = await mkdtemp(join(tmpdir(), "rex-merge-driver-"));
    git(repo, "init", "-b", "main");
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "user.name", "Test");
    // Register the driver exactly the way ndx init will.
    git(repo, "config", "merge.rex-prd.name", "n-dx PRD tree merge");
    git(
      repo,
      "config",
      "merge.rex-prd.driver",
      `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI_DIST)} merge-driver %O %A %B`,
    );
    await writeFile(join(repo, ".gitattributes"), ".rex/prd_tree/** merge=rex-prd\n", "utf-8");

    await mkdir(join(repo, ".rex/prd_tree"), { recursive: true });
    await writeFile(
      join(repo, ITEM_PATH),
      itemDoc({ status: "pending", tags: ["core"], lastModified: "2026-08-01T00:00:00Z" }),
      "utf-8",
    );
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "base");
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("merges two divergent PRD branches cleanly", async () => {
    // Branch A: completes the task (later stamp) …
    git(repo, "checkout", "-b", "branch-a");
    await writeFile(
      join(repo, ITEM_PATH),
      itemDoc({ status: "completed", tags: ["core"], lastModified: "2026-08-20T00:00:00Z" }),
      "utf-8",
    );
    git(repo, "commit", "-am", "complete the task");

    // … branch B: re-statuses it earlier AND adds a tag.
    git(repo, "checkout", "main");
    git(repo, "checkout", "-b", "branch-b");
    await writeFile(
      join(repo, ITEM_PATH),
      itemDoc({ status: "in_progress", tags: ["core", "urgent"], lastModified: "2026-08-10T00:00:00Z" }),
      "utf-8",
    );
    git(repo, "commit", "-am", "start the task, tag it urgent");

    // Merging A into B must succeed with no conflicts …
    git(repo, "merge", "branch-a", "-m", "merge");

    const merged = await readFile(join(repo, ITEM_PATH), "utf-8");
    // … keeping the later status, the later stamp, and the union of tags.
    expect(merged).toContain('status: "completed"');
    expect(merged).toContain('lastModified: "2026-08-20T00:00:00Z"');
    expect(merged).toContain('- "core"');
    expect(merged).toContain('- "urgent"');
    expect(merged).not.toContain("<<<<<<<");
  });

  it("leaves standard conflict markers and a conflicted index on a genuine conflict", async () => {
    // Both sides change status with NO lastModified stamps to arbitrate.
    git(repo, "checkout", "-b", "branch-a");
    await writeFile(join(repo, ITEM_PATH), itemDoc({ status: "completed", tags: ["core"] }), "utf-8");
    git(repo, "commit", "-am", "complete");

    git(repo, "checkout", "main");
    git(repo, "checkout", "-b", "branch-b");
    await writeFile(join(repo, ITEM_PATH), itemDoc({ status: "failing", tags: ["core"] }), "utf-8");
    git(repo, "commit", "-am", "fail");

    expect(() => git(repo, "merge", "branch-a", "-m", "merge")).toThrow();

    const conflicted = await readFile(join(repo, ITEM_PATH), "utf-8");
    expect(conflicted).toContain("<<<<<<<");
    expect(conflicted).toContain("=======");
    expect(conflicted).toContain(">>>>>>>");
    // Git still lists the path as unmerged.
    const status = git(repo, "status", "--porcelain");
    expect(status).toMatch(/^(UU|AA)\s+\.rex\/prd_tree\//m);
  });
});
