/**
 * `WriteOptions.preserveModifiedBy` — authorship on a cascaded write.
 *
 * GitHub #368: a run that had made zero tool calls auto-completed a task and
 * an epic belonging to someone else, and rewrote `lastModifiedBy` on both to
 * the user who happened to be running the command. The status change was one
 * bug; the authorship rewrite was a second one, and it is what made the loss
 * hard to see — `git blame` on the PRD pointed at the wrong person.
 *
 * A cascade is a consequence of a write, not a write the user asked for, so
 * it stamps `lastModified` (the item really did change) but leaves
 * `lastModifiedBy` with whoever last touched the item deliberately.
 *
 * Both local stores are covered: FileStore and FolderTreeStore have separate
 * `updateItem` implementations, so a fix to one is not a fix to the other.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FolderTreeStore, ensureFolderTreeRexDir } from "../../../src/store/folder-tree-store.js";
import { FileStore } from "../../../src/store/file-adapter.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import type { PRDStore } from "../../../src/store/contracts.js";
import type { PRDItem } from "../../../src/schema/index.js";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The colleague who actually owns the item the cascade is about to close. */
const OTHER_AUTHOR = "sterling.h@endash.us";

function seedItems(): PRDItem[] {
  return [
    {
      id: "epic-1",
      title: "Epic One",
      level: "epic",
      status: "pending",
      lastModified: "2020-01-01T00:00:00.000Z",
      lastModifiedBy: OTHER_AUTHOR,
      children: [
        {
          id: "task-a",
          title: "Task A",
          level: "task",
          status: "in_progress",
          lastModified: "2020-01-01T00:00:00.000Z",
          lastModifiedBy: OTHER_AUTHOR,
        },
      ],
    } as PRDItem,
  ];
}

const STORES: Array<{ name: string; create: (rexDir: string) => PRDStore }> = [
  { name: "FolderTreeStore", create: (rexDir) => new FolderTreeStore(rexDir) },
  { name: "FileStore", create: (rexDir) => new FileStore(rexDir) },
];

describe.each(STORES)("$name preserveModifiedBy", ({ create }) => {
  let tmpDir: string;
  let store: PRDStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-preserve-author-"));
    const rexDir = join(tmpDir, ".rex");
    await ensureFolderTreeRexDir(rexDir);
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "preserve-author", adapter: "folder-tree" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");

    store = create(rexDir);
    await store.saveDocument({
      schema: "rex/v1",
      title: "Preserve Author",
      items: seedItems(),
    });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("keeps the existing author when set", async () => {
    await store.updateItem("task-a", { status: "completed" }, { preserveModifiedBy: true });

    const item = await store.getItem("task-a");
    expect(item!.status).toBe("completed");
    expect(item!.lastModifiedBy).toBe(OTHER_AUTHOR);
  });

  it("still records that the item changed", async () => {
    await store.updateItem("task-a", { status: "completed" }, { preserveModifiedBy: true });

    const item = await store.getItem("task-a");
    expect(item!.lastModified).toMatch(ISO_TIMESTAMP);
    expect(item!.lastModified).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("stamps the current actor without the flag", async () => {
    await store.updateItem("task-a", { status: "completed" });

    const item = await store.getItem("task-a");
    expect(item!.lastModifiedBy).toBeTruthy();
    expect(item!.lastModifiedBy).not.toBe(OTHER_AUTHOR);
  });

  it("falls back to the current actor when there is no prior author", async () => {
    await store.updateItem("epic-1", { lastModifiedBy: undefined });
    await store.updateItem("epic-1", { status: "completed" }, { preserveModifiedBy: true });

    const item = await store.getItem("epic-1");
    expect(item!.lastModifiedBy).toBeTruthy();
  });
});
