/**
 * `rex validate` must notice a tree written in a foreign slug convention.
 *
 * The rule is now title-only, with `-{id6}` added only where siblings collide.
 * It superseded a rule that appended `-{id6}` to every slug unconditionally,
 * so a build on either side of the change rewrites the whole tree on its first
 * write — the direction differs, the damage does not. Observed 2026-09-01:
 * 1365 of 1369 files renamed by one status update through a stale MCP server.
 * Nothing failed: every rename was R100, no content was lost, and `rex
 * validate` reported all checks passed, because it inspects item fields and
 * never looks at the paths those items live in.
 *
 * That silence is the problem. A stray writer's 800-file rewrite is
 * indistinguishable from an intentional migration, and it lands in whatever PR
 * happens to be open. This check gives the tree a voice: paths that disagree
 * with what the current serializer would produce are reported, so the rewrite
 * is caught at review time rather than discovered in a diff.
 *
 * @see packages/rex/src/store/folder-tree-serializer.ts — slugify
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, rename, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../../src/store/file-adapter.js";
import { findNonConformingSlugs } from "../../src/store/folder-tree-serializer.js";
import type { PRDDocument } from "../../src/schema/index.js";

const DOC: PRDDocument = {
  schema: "rex/v1",
  title: "Slug Conformance",
  items: [
    {
      id: "epic-abc123",
      title: "Child Process Cleanup And Exit Hygiene",
      level: "epic",
      status: "pending",
      children: [
        { id: "task-def456", title: "Harden the runner", level: "task", status: "pending" },
      ],
    },
  ],
};

let projectDir: string;
let rexDir: string;
let treeRoot: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "rex-slug-conform-"));
  rexDir = join(projectDir, ".rex");
  await mkdir(rexDir, { recursive: true });
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ version: "1.0" }), "utf-8");
  await new FileStore(rexDir).saveDocument(DOC);
  treeRoot = join(rexDir, "prd_tree");
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("findNonConformingSlugs", () => {
  it("reports nothing for a tree the current serializer wrote", async () => {
    expect(await findNonConformingSlugs(DOC.items, treeRoot)).toEqual([]);
  });

  it("reports a directory written in the superseded id-qualified form", async () => {
    // Exactly what a build on the other side of the change produces: the title
    // body truncated to leave room for a `-{id6}` suffix that the current rule
    // adds only on a sibling collision.
    const entries = (await readdir(treeRoot)).filter((e) => e !== "tree-meta.json");
    const current = entries[0];
    await rename(join(treeRoot, current), join(treeRoot, "child-process-cleanup-and-exit-epicab"));

    const findings = await findNonConformingSlugs(DOC.items, treeRoot);

    expect(findings).toHaveLength(1);
    expect(findings[0].expected).toBe(current);
    expect(findings[0].found).toBe("child-process-cleanup-and-exit-epicab");
    expect(findings[0].id).toBe("epic-abc123");
  });

  it("reports a non-conforming leaf file, not just directories", async () => {
    const epicDir = (await readdir(treeRoot)).filter((e) => e !== "tree-meta.json")[0];
    const inside = (await readdir(join(treeRoot, epicDir))).filter((f) => f !== "index.md");
    await rename(
      join(treeRoot, epicDir, inside[0]),
      join(treeRoot, epicDir, "harden-the-runner-taskde.md"),
    );

    const findings = await findNonConformingSlugs(DOC.items, treeRoot);

    expect(findings.map((f) => f.id)).toEqual(["task-def456"]);
    expect(findings[0].found).toBe("harden-the-runner-taskde.md");
  });

  it("does not flag an item whose file is simply absent", async () => {
    // Missing files are a different fault with its own reporting; conflating
    // the two would make the slug finding noisy and easy to dismiss.
    const epicDir = (await readdir(treeRoot)).filter((e) => e !== "tree-meta.json")[0];
    const inside = (await readdir(join(treeRoot, epicDir))).filter((f) => f !== "index.md");
    await rm(join(treeRoot, epicDir, inside[0]));

    expect(await findNonConformingSlugs(DOC.items, treeRoot)).toEqual([]);
  });
});
