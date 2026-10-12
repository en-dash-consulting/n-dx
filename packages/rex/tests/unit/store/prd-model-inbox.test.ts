/**
 * The reserved Inbox folder, `changes/inbox/`: the writer stores top-level
 * changes with `needsPlacement` there and moves them out when placement
 * clears the flag; the reader folds them back in as top-level changes. Trees
 * written before the folder was reserved (Inbox changes at the changes root)
 * still read, and move in on the next write.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { loadPrdModel, type PrdModel } from "../../../src/store/prd-model-reader.js";
import { writePrdModel } from "../../../src/store/prd-model-writer.js";
import { withPrdModelTransaction } from "../../../src/store/prd-model-transaction.js";
import { exportV2Bundle, importBundleIntoV2, parseAnyBundle } from "../../../src/store/prd-bundle-v2.js";
import { withLock } from "../../../src/store/file-lock.js";
import { prdLockPath } from "../../../src/store/paths.js";
import { addChangeNode } from "../../../src/core/change-add.js";
import { recordPlacement } from "../../../src/core/change-place.js";
import { indexTree, type RuleNode } from "../../../src/schema/v2-rules.js";
import { copyV2Fixture } from "../../helpers/v2-fixture.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const CHANGE = "c0000000-0000-4000-8000-000000000001";
const HELD = "d0000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-12T00:00:00.000Z");
const quiet = { env: {}, warn: () => {} };

let tmp: string;
let rexDir: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-inbox-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const load = () => loadPrdModel(rexDir, quiet);
const write = (model: PrdModel) => withLock(prdLockPath(rexDir), () => writePrdModel(rexDir, model));
const held = (fields: Partial<RuleNode> = {}) =>
  ({ id: HELD, type: "change", title: "Sort this out", slug: "sort-this-out", needsPlacement: true, ...fields }) as RuleNode;

/** Add `node` to the change layer through the transaction. */
async function addChange(node: RuleNode): Promise<void> {
  await withPrdModelTransaction(rexDir, (model) => ({ tree: { ...model.tree, changes: [...model.tree.changes, node] }, result: undefined }));
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "prd.lock") continue;
      const p = join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else out[relative(dir, p).split("\\").join("/")] = await readFile(p, "utf-8");
    }
  };
  await walk(dir);
  return out;
}

describe("writing the Inbox", () => {
  it("stores an Inbox change in changes/inbox/<slug>/ with needsPlacement in that folder's state.yaml", async () => {
    await addChange(held());
    const folder = join(rexDir, "changes", "inbox", "sort-this-out");
    expect(await readFile(join(folder, "index.md"), "utf-8")).toContain(`id: "${HELD}"`);
    expect(await readFile(join(folder, "state.yaml"), "utf-8")).toContain("needsPlacement: true");
    expect(existsSync(join(rexDir, "changes", "sort-this-out"))).toBe(false);
    // The reserved folder is not a node: no index.md, and no state.yaml of its own.
    expect((await readdir(join(rexDir, "changes", "inbox"))).sort()).toEqual(["sort-this-out"]);
  });

  it("keeps a nested change awaiting placement under its parent", async () => {
    await addChange({ id: "e0000000-0000-4000-8000-000000000001", type: "change", title: "Parent", slug: "parent", touches: [CAPABILITY], children: [held()] } as RuleNode);
    expect(existsSync(join(rexDir, "changes", "parent", "sort-this-out", "index.md"))).toBe(true);
    expect(existsSync(join(rexDir, "changes", "inbox"))).toBe(false);
  });

  it("moves a placed change out to the changes root, keeping its id, slug and state, and removes the empty Inbox", async () => {
    await addChange(held({ status: "in_progress", startedAt: "2026-10-11T00:00:00.000Z" }));
    await withPrdModelTransaction(rexDir, (model) => ({ tree: recordPlacement(model.tree, HELD, { target: CAPABILITY, relation: "touches" }, NOW).tree, result: undefined }));

    expect(existsSync(join(rexDir, "changes", "inbox"))).toBe(false);
    const state = await readFile(join(rexDir, "changes", "sort-this-out", "state.yaml"), "utf-8");
    expect(state).toContain("startedAt");
    expect(state).not.toContain("needsPlacement");
    const node = (await load()).tree.changes.find((c) => c.id === HELD);
    expect(node).toMatchObject({ id: HELD, slug: "sort-this-out", status: "in_progress", touches: [CAPABILITY] });
    expect(node).not.toHaveProperty("needsPlacement");
  });

  it("refuses a top-level change slugged inbox, in any case, writing nothing", async () => {
    const before = await snapshot(rexDir);
    for (const slug of ["inbox", "Inbox"]) {
      const model = await load();
      model.tree.changes.push(held({ slug, needsPlacement: undefined, touches: [CAPABILITY] }));
      await expect(write(model)).rejects.toThrow(/reserved Inbox folder/);
    }
    expect(await snapshot(rexDir)).toEqual(before);
  });

  it("gives a new top-level change titled Inbox another slug", async () => {
    const { node } = addChangeNode((await load()).tree, { type: "change", title: "Inbox" }, { now: NOW, newId: () => HELD });
    expect(node.slug).toBe("inbox-d00000");
  });
});

describe("reading the Inbox", () => {
  it("reads changes/inbox/ as a reserved folder: its changes are top-level changes in the Inbox", async () => {
    await addChange(held());
    const model = await load();
    expect(model.warnings).toEqual([]);
    expect(model.tree.changes.map((c) => c.id)).toEqual([CHANGE, HELD]);
    expect(model.tree.changes[1]).toMatchObject({ type: "change", slug: "sort-this-out", needsPlacement: true });
    expect(indexTree(model.tree).resolve("inbox")).toBeUndefined();
  });

  it("reads a change stored in the Inbox as awaiting placement even when its row says nothing", async () => {
    await addChange(held());
    await rm(join(rexDir, "changes", "inbox", "sort-this-out", "state.yaml"));
    expect((await load()).tree.changes.find((c) => c.id === HELD)).toMatchObject({ needsPlacement: true });
  });

  it("skips a non-change in the Inbox with a warning, and the next write refuses to delete it", async () => {
    await mkdir(join(rexDir, "changes", "inbox"), { recursive: true });
    await writeFile(
      join(rexDir, "changes", "inbox", "stray.md"),
      '---\nid: "f0000000-0000-4000-8000-000000000001"\ntype: "task"\ntitle: "Stray"\nslug: "stray"\n---\n',
    );
    const model = await load();
    expect(model.tree.changes.map((c) => c.id)).toEqual([CHANGE]);
    expect(model.warnings).toEqual([expect.objectContaining({ message: expect.stringMatching(/Inbox holds only changes/), skipped: true })]);
    await expect(write(model)).rejects.toThrow(/stray\.md holds node f0000000/);
  });
});

describe("a tree written before the Inbox folder was reserved", () => {
  /** Write an Inbox change at the changes root, as #612 did. */
  async function legacyInboxChange(): Promise<void> {
    const folder = join(rexDir, "changes", "sort-this-out");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "index.md"), `---\nid: "${HELD}"\ntype: "change"\ntitle: "Sort this out"\nslug: "sort-this-out"\n---\n`);
    await writeFile(join(folder, "state.yaml"), `schema: "rex/v2"\nitems:\n  "${HELD}":\n    needsPlacement: true\n`);
  }

  it("still reads, and the next write through the transaction moves the change into changes/inbox/", async () => {
    await legacyInboxChange();
    const before = await load();
    expect(before.warnings).toEqual([]);
    expect(before.tree.changes.find((c) => c.id === HELD)).toMatchObject({ needsPlacement: true });

    await withPrdModelTransaction(rexDir, (model) => ({ tree: model.tree, result: undefined }));
    expect(existsSync(join(rexDir, "changes", "sort-this-out"))).toBe(false);
    expect(await readFile(join(rexDir, "changes", "inbox", "sort-this-out", "state.yaml"), "utf-8")).toContain("needsPlacement: true");
    expect((await load()).tree).toEqual(before.tree);
  });
});

describe("the bundle", () => {
  it("round-trips a tree with an Inbox folder byte-identically", async () => {
    await addChange(held());
    const { bundle } = await exportV2Bundle(rexDir, { exportedAt: "2026-10-12T00:00:00.000Z" });
    const dest = join(tmp, "dest");
    await mkdir(join(dest, "product"), { recursive: true });
    await writeFile(join(dest, "product", "index.md"), '---\ntitle: "Empty"\nschema: "rex/v2"\n---\n');
    await importBundleIntoV2(dest, parseAnyBundle(JSON.parse(JSON.stringify(bundle))), "merge");
    expect(await snapshot(dest)).toEqual(await snapshot(rexDir));
  });
});
