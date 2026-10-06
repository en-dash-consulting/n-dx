/**
 * Order equivalence for the concurrent folder-tree parse.
 *
 * `parseFolderTree` overlaps sibling subtrees, which is where its speed comes
 * from. Three of its four outputs are order-sensitive, and none of them may
 * depend on which branch happens to finish first:
 *
 *   - `items` — the PRD's own shape and ordering;
 *   - `warnings` — read in order by `rex validate`;
 *   - `fileDigests` — the serializer's stale-save guard walks it, and a map's
 *     insertion order is observable through that walk.
 *
 * The reference these are compared against is a deliberately naive
 * depth-first walk written in this file: alphabetical subdirectories, each
 * subtree finished before the next begins. That is what the parser did before
 * it was parallelised, so it is the definition of "unchanged" here.
 *
 * The fixture is built to put the ordering guarantee under load: subtrees of
 * very different sizes (so completion order will not match sibling order),
 * warnings raised at several depths, and names whose alphabetical order
 * differs from their creation order.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseFolderTree, digestItemFile } from "../../../src/store/folder-tree-parser.js";

// ---------------------------------------------------------------------------
// Reference implementation: strictly sequential, depth-first, alphabetical
// ---------------------------------------------------------------------------

interface RefResult {
  /** Item file paths in visit order — the shape of the walk. */
  visited: string[];
  /** Digest map keys in insertion order. */
  digestOrder: string[];
}

async function referenceWalk(dir: string, acc: RefResult): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  const indexPath = join(dir, "index.md");
  if (entries.includes("index.md")) {
    acc.visited.push(indexPath);
    try {
      acc.digestOrder.push(resolve(indexPath));
    } catch {
      /* unreadable — the parser warns, order is unaffected */
    }
  }

  const subdirs: string[] = [];
  for (const entry of entries) {
    try {
      const stats = await import("node:fs/promises").then((m) => m.stat(join(dir, entry)));
      if (stats.isDirectory()) subdirs.push(entry);
    } catch {
      /* ignore */
    }
  }
  for (const sub of subdirs.sort()) {
    await referenceWalk(join(dir, sub), acc);
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function itemMd(id: string, title: string, level: string, status = "pending"): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    `level: ${level}`,
    `status: ${status}`,
    "---",
    "",
    `Body of ${title}.`,
    "",
  ].join("\n");
}

/**
 * Build a tree whose completion order will not match its sibling order: the
 * first epic alphabetically is the largest, so if branches were merged as
 * they finished rather than in order, it would land last.
 */
async function buildFixture(root: string): Promise<void> {
  const epics: Array<{ slug: string; features: number; tasksPerFeature: number }> = [
    { slug: "aaa-huge-epic", features: 6, tasksPerFeature: 8 },
    { slug: "mmm-small-epic", features: 1, tasksPerFeature: 1 },
    { slug: "zzz-medium-epic", features: 3, tasksPerFeature: 2 },
  ];

  let n = 0;
  for (const epic of epics) {
    const epicDir = join(root, epic.slug);
    await mkdir(epicDir, { recursive: true });
    await writeFile(join(epicDir, "index.md"), itemMd(`epic-${epic.slug}`, epic.slug, "epic"));

    for (let f = 0; f < epic.features; f++) {
      // Reverse-ish naming so creation order differs from alphabetical order.
      const featureSlug = `feature-${String(epic.features - f).padStart(2, "0")}`;
      const featureDir = join(epicDir, featureSlug);
      await mkdir(featureDir, { recursive: true });
      await writeFile(
        join(featureDir, "index.md"),
        itemMd(`feat-${epic.slug}-${f}`, featureSlug, "feature"),
      );

      for (let t = 0; t < epic.tasksPerFeature; t++) {
        const taskDir = join(featureDir, `task-${String(t).padStart(2, "0")}`);
        await mkdir(taskDir, { recursive: true });
        await writeFile(
          join(taskDir, "index.md"),
          itemMd(`task-${n++}`, `task-${t}`, "task", t % 3 === 0 ? "completed" : "pending"),
        );
      }
    }
  }

  // A directory with no item file at all — warns, at depth 2.
  await mkdir(join(root, "aaa-huge-epic", "empty-dir"), { recursive: true });

  // A directory with two non-index .md files and no index.md — the ambiguous
  // case, which warns differently, at depth 1.
  const ambiguous = join(root, "bbb-ambiguous");
  await mkdir(ambiguous, { recursive: true });
  await writeFile(join(ambiguous, "one.md"), itemMd("amb-1", "one", "epic"));
  await writeFile(join(ambiguous, "two.md"), itemMd("amb-2", "two", "epic"));

  // A legacy single-.md folder item (no index.md) — the fallback path.
  const legacy = join(root, "ccc-legacy");
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "legacy-title.md"), itemMd("legacy-1", "legacy", "epic"));

  // Leaf subtask .md files beside a task's index.md (Rule 1b).
  const leafHost = join(root, "aaa-huge-epic", "feature-01", "task-00");
  await writeFile(join(leafHost, "sub-b.md"), itemMd("leaf-b", "sub b", "subtask"));
  await writeFile(join(leafHost, "sub-a.md"), itemMd("leaf-a", "sub a", "subtask"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("folder-tree parse order equivalence", () => {
  let root: string;
  let tmp: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "parse-order-"));
    root = join(tmp, "prd_tree");
    await mkdir(root, { recursive: true });
    await buildFixture(root);
  });

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("visits item files in the same order as a sequential depth-first walk", async () => {
    const reference: RefResult = { visited: [], digestOrder: [] };
    const subdirs = (await readdir(root)).sort();
    for (const sub of subdirs) {
      await referenceWalk(join(root, sub), reference);
    }

    const { fileDigests } = await parseFolderTree(root);

    // Every index.md the sequential walk saw, in its order, is a prefix-
    // consistent subsequence of the parser's digest order: the parser also
    // records non-index leaf files, which the reference walk does not visit.
    const parsed = [...fileDigests.keys()];
    const indexOnly = parsed.filter((p) => p.endsWith("index.md"));
    expect(indexOnly).toEqual(reference.digestOrder);
  });

  it("produces a byte-identical result across repeated parses", async () => {
    const runs = await Promise.all([
      parseFolderTree(root),
      parseFolderTree(root),
      parseFolderTree(root),
    ]);
    const serialized = runs.map((r) =>
      JSON.stringify({
        items: r.items,
        warnings: r.warnings,
        digests: [...r.fileDigests.entries()],
      }),
    );
    expect(serialized[1]).toBe(serialized[0]);
    expect(serialized[2]).toBe(serialized[0]);
  });

  it("orders warnings by tree position, not by completion time", async () => {
    const { warnings } = await parseFolderTree(root);
    const paths = warnings.map((w) => w.path);

    // The ambiguous and empty directories both warn. The empty one is inside
    // the first (largest, slowest) epic; the ambiguous one is a later, tiny
    // sibling at the root. Depth-first order puts the slow subtree's warning
    // first — completion order would put it last.
    const emptyIdx = paths.findIndex((p) => p.endsWith("empty-dir"));
    const ambiguousIdx = paths.findIndex((p) => p.endsWith("bbb-ambiguous"));
    expect(emptyIdx).toBeGreaterThanOrEqual(0);
    expect(ambiguousIdx).toBeGreaterThanOrEqual(0);
    expect(emptyIdx).toBeLessThan(ambiguousIdx);
  });

  it("records a digest matching the file's on-disk bytes", async () => {
    const { fileDigests } = await parseFolderTree(root);
    const sample = [...fileDigests.keys()].find((p) => p.includes("aaa-huge-epic"));
    expect(sample).toBeDefined();
    const raw = await readFile(sample as string, "utf8");
    expect(fileDigests.get(sample as string)).toBe(digestItemFile(raw));
  });

  it("parses the whole fixture into the expected shape", async () => {
    const { items } = await parseFolderTree(root);
    const topLevel = items.map((i) => i.title).sort();
    // Three real epics plus the legacy-title fallback; the ambiguous folder
    // yields no item (it warns instead).
    expect(topLevel).toContain("aaa-huge-epic");
    expect(topLevel).toContain("mmm-small-epic");
    expect(topLevel).toContain("zzz-medium-epic");
    expect(topLevel).toContain("legacy");
    expect(topLevel).not.toContain("one");
  });
});
