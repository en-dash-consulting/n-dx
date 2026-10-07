/**
 * `realizedBy`: the files and zones of the commits of the changes that amended
 * a capability, found by N-DX-Item trailer. Runs against a real fixture repository.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { COMMIT_FILES_CACHE_FILENAME, loadCommitFiles } from "../../src/core/change-commits.js";
import { computeEdges, computeRealizedBy } from "../../src/core/product-edges.js";
import type { RuleNode, V2Tree } from "../../src/schema/v2-rules.js";

let repo: string;
let cacheDir: string;
let clock = 0;

function git(...args: string[]): string {
  clock += 1;
  const date = new Date(Date.UTC(2026, 9, 1, 0, clock)).toISOString();
  return execFileSync("git", args, { cwd: repo, encoding: "utf-8", env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }).trim();
}

async function commit(files: string[], message: string): Promise<string> {
  for (const file of files) {
    await mkdir(join(repo, file, ".."), { recursive: true });
    await writeFile(join(repo, file), `${file} ${clock}\n`, "utf-8");
    git("add", file);
  }
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

const node = (fields: Record<string, unknown>): RuleNode => ({ title: fields.id as string, slug: fields.id as string, ...fields }) as RuleNode;
const tree: V2Tree = {
  product: [node({ id: "cap-a", type: "capability" }), node({ id: "cap-b", type: "capability" })],
  changes: [
    node({
      id: "ch-1",
      type: "change",
      aliases: ["old-ch-1"],
      amends: [{ target: "cap-a", delta: "modified", summary: "s" }],
      children: [node({ id: "task-1", type: "task" })],
    }),
    node({ id: "ch-2", type: "change", amends: [{ target: "cap-b", delta: "added", summary: "s" }], touches: ["cap-a"] }),
  ],
};
const zoneOf = (file: string) => (file.startsWith("src/web/") ? "web" : file.startsWith("src/rex/") ? "rex" : undefined);

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "rex-realized-by-"));
  repo = join(root, "repo");
  cacheDir = join(repo, ".ndx", "rex", ".cache");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("config", "user.email", "dev@example.com");
  git("config", "user.name", "Dev");
  git("config", "commit.gpgsign", "false");
});

afterEach(async () => {
  await rm(join(repo, ".."), { recursive: true, force: true });
});

describe("computeRealizedBy", () => {
  it("collects files and zones from the commits of the changes that amended the capability", async () => {
    await commit(["README.md"], "Initial commit");
    const viaChange = await commit(["src/rex/a.ts", "docs/é.md"], "Part A\n\nN-DX-Item: ch-1");
    const viaTask = await commit(["src/web/b.ts"], "Part B\n\nN-DX-Item: task-1");
    const viaAlias = await commit(["src/rex/c.ts"], "Part C\n\nN-DX-Item: old-ch-1");
    const forB = await commit(["src/web/d.ts"], "Part D\n\nN-DX-Item: ch-2");
    await commit(["src/web/unrelated.ts"], "Other\n\nN-DX-Item: someone-else");

    const realized = await computeRealizedBy(tree, computeEdges(tree), { repoDir: repo, cacheDir, zoneOf });

    expect(realized["cap-a"]).toEqual({
      commits: [viaAlias, viaTask, viaChange],
      files: ["docs/é.md", "src/rex/a.ts", "src/rex/c.ts", "src/web/b.ts"],
      zones: ["rex", "web"],
    });
    // ch-2 only touches cap-a, so its commit realizes cap-b alone.
    expect(realized["cap-b"]).toEqual({ commits: [forB], files: ["src/web/d.ts"], zones: ["web"] });
  });

  it("credits a merged branch's files to the merge commit, and leaves zones empty without a zone map", async () => {
    await commit(["README.md"], "Initial commit");
    git("checkout", "-q", "-b", "feat");
    await commit(["src/rex/x.ts"], "On the branch");
    git("checkout", "-q", "main");
    await commit(["main.txt"], "On main");
    git("merge", "-q", "--no-ff", "-m", "Merge feat\n\nN-DX-Item: ch-1", "feat");
    const merge = git("rev-parse", "HEAD");

    const realized = await computeRealizedBy(tree, computeEdges(tree), { repoDir: repo, cacheDir });
    expect(realized["cap-a"]).toEqual({ commits: [merge], files: ["src/rex/x.ts"], zones: [] });
  });
});

describe("commit-files cache", () => {
  it("is rebuilt when missing or unreadable, and only reads commits it lacks", async () => {
    await commit(["README.md"], "Initial commit");
    const first = await commit(["a.txt"], "A");
    const second = await commit(["b.txt"], "B");
    const cacheFile = join(cacheDir, COMMIT_FILES_CACHE_FILENAME);

    expect((await loadCommitFiles(repo, cacheDir, [first])).get(first)).toEqual(["a.txt"]);
    await rm(cacheFile);
    expect((await loadCommitFiles(repo, cacheDir, [first])).get(first)).toEqual(["a.txt"]);
    await writeFile(cacheFile, "{ torn", "utf-8");
    expect((await loadCommitFiles(repo, cacheDir, [first])).get(first)).toEqual(["a.txt"]);

    // Only a cache hit can return a value git never produced; `second` is read from git.
    const cached = JSON.parse(await readFile(cacheFile, "utf-8"));
    await writeFile(cacheFile, JSON.stringify({ ...cached, files: { [first]: ["from-cache.txt"] } }), "utf-8");
    const both = await loadCommitFiles(repo, cacheDir, [first, second]);
    expect(both.get(first)).toEqual(["from-cache.txt"]);
    expect(both.get(second)).toEqual(["b.txt"]);
    expect(Object.keys(JSON.parse(await readFile(cacheFile, "utf-8")).files).sort()).toEqual([first, second].sort());
  });
});
