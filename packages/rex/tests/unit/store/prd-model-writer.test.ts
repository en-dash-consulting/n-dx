/**
 * The v2 tree writer: frozen slugs, no Children tables, intent in Markdown and
 * state in state.yaml, and byte-identical round-trips of the v2 fixture.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { loadPrdModel, type PrdModel } from "../../../src/store/prd-model-reader.js";
import { writePrdModel, type WritePrdModelOptions } from "../../../src/store/prd-model-writer.js";
import { withLock } from "../../../src/store/file-lock.js";
import { prdLockPath } from "../../../src/store/paths.js";
import { SLUG_RULE_VERSION } from "../../../src/store/folder-tree-serializer.js";
import type { RuleNode } from "../../../src/schema/v2-rules.js";
import { EOLS, copyV2Fixture, type Eol } from "../../helpers/v2-fixture.js";
const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";

const quiet = { env: {}, warn: () => {} };

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-model-writer-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** The v2 fixture under `tmp` with `eol` line endings: a Windows checkout may hand it over as CRLF. */
function copyFixture(eol: Eol = "lf", name = ".rex"): Promise<string> {
  return copyV2Fixture(join(tmp, name), eol);
}

function write(rexDir: string, model: PrdModel, options?: WritePrdModelOptions) {
  return withLock(prdLockPath(rexDir), () => writePrdModel(rexDir, model, options));
}

/** Every file under `dir`, relative, with its text. Dotfiles (the lock) are skipped. */
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

function find(nodes: RuleNode[], id: string): RuleNode {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = node.children && findOrNull(node.children, id);
    if (hit) return hit;
  }
  throw new Error(`node ${id} not found`);
}

function findOrNull(nodes: RuleNode[], id: string): RuleNode | null {
  try {
    return find(nodes, id);
  } catch {
    return null;
  }
}

function all(model: PrdModel): RuleNode[] {
  return [...model.tree.product, ...model.tree.changes];
}

describe.each(EOLS)("writePrdModel on a %s checkout", (eol) => {
  it("round-trips the v2 fixture byte-identically, in LF", async () => {
    const model = await loadPrdModel(await copyFixture(eol), quiet);
    expect(model.warnings).toEqual([]);
    const rexDir = join(tmp, "fresh");
    await mkdir(rexDir);
    await write(rexDir, model);
    expect(await snapshot(rexDir)).toEqual(await snapshot(await copyFixture("lf", "lf")));
  });

  it("writes nothing when the tree is unchanged, leaving every file's bytes alone", async () => {
    const rexDir = await copyFixture(eol);
    const before = await snapshot(rexDir);
    const result = await write(rexDir, await loadPrdModel(rexDir, quiet));
    expect(result).toEqual({ written: [], removed: [] });
    expect(await snapshot(rexDir)).toEqual(before);
  });

  it("keeps every path when titles change", async () => {
    const rexDir = await copyFixture(eol);
    const before = Object.keys(await snapshot(rexDir)).sort();
    const model = await loadPrdModel(rexDir, quiet);
    find(all(model), CHANGE).title = "Offer wallets at checkout";
    find(all(model), CAPABILITY).title = "Pay by card or wallet";
    model.title = "Renamed shop";

    const result = await write(rexDir, model);

    expect(Object.keys(await snapshot(rexDir)).sort()).toEqual(before);
    expect(result.removed).toEqual([]);
    expect(result.written.sort()).toEqual(["changes/add-apple-pay/index.md", "product/checkout/pay-by-card.md", "product/index.md"]);
    const change = await readFile(join(rexDir, "changes/add-apple-pay/index.md"), "utf-8");
    expect(change).toContain('title: "Offer wallets at checkout"\nslug: "add-apple-pay"\n');
    const reread = await loadPrdModel(rexDir, quiet);
    expect(find(all(reread), CAPABILITY)).toMatchObject({ title: "Pay by card or wallet", slug: "pay-by-card" });
    expect(reread.title).toBe("Renamed shop");
  });

  it("keeps CRLF in a file it leaves alone and writes LF to the one it changes", async () => {
    const rexDir = await copyFixture(eol);
    const before = await snapshot(rexDir);
    const model = await loadPrdModel(rexDir, quiet);
    find(all(model), CHANGE).title = "Retitled";

    expect(await write(rexDir, model)).toEqual({ written: ["changes/add-apple-pay/index.md"], removed: [] });
    const after = await snapshot(rexDir);
    expect(after["changes/add-apple-pay/index.md"]).not.toContain("\r");
    delete after["changes/add-apple-pay/index.md"];
    delete before["changes/add-apple-pay/index.md"];
    expect(after).toEqual(before);
  });
});

/** The remaining cases edit and compare text in LF terms, so they run on an LF copy whatever the checkout. */
describe("writePrdModel", () => {
  it("never writes a Children table", async () => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    const task = find(all(model), TASK);
    task.children = [{ id: "s1", type: "subtask", title: "Hide on Chrome", slug: "hide-on-chrome", status: "pending" } as RuleNode];
    await write(rexDir, model);

    const indexes = Object.entries(await snapshot(rexDir)).filter(([path]) => path.endsWith("index.md"));
    expect(indexes.map(([path]) => path).sort()).toEqual([
      "changes/add-apple-pay/index.md",
      "changes/add-apple-pay/wire-the-button/index.md",
      "product/checkout/index.md",
      "product/index.md",
    ]);
    for (const [path, text] of indexes) expect(text, path).not.toMatch(/Children|\| Title \|/);
  });

  it("puts state in state.yaml, the stamp and slug rule in the root header, and no tree-meta.json", async () => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    Object.assign(find(all(model), TASK), { status: "completed", completedAt: "2026-10-02T10:00:00.000Z", assignee: "A <a@x>" });
    await write(rexDir, model);

    const leaf = await readFile(join(rexDir, "changes/add-apple-pay/wire-the-button.md"), "utf-8");
    expect(leaf).not.toMatch(/status|completedAt|assignee/);
    const state = await readFile(join(rexDir, "changes/add-apple-pay/state.yaml"), "utf-8");
    expect(state).toContain(`  "${TASK}":\n    status: "completed"\n    completedAt: "2026-10-02T10:00:00.000Z"\n    assignee: "A <a@x>"\n`);
    const root = await readFile(join(rexDir, "product/index.md"), "utf-8");
    expect(root).toMatch(new RegExp(`^---\\ntitle: "Fixture shop"\\nschema: "rex/v2"\\nslugRule: ${SLUG_RULE_VERSION}\\n`));
    expect(Object.keys(await snapshot(rexDir))).not.toContain("tree-meta.json");
  });

  it("keeps a state field this build does not know in state.yaml", async () => {
    const rexDir = await copyFixture();
    const statePath = join(rexDir, "changes/add-apple-pay/state.yaml");
    await writeFile(statePath, (await readFile(statePath, "utf-8")) + "    futureField: 'kept'\n");
    const model = await loadPrdModel(rexDir, quiet);
    find(all(model), CHANGE).title = "Retitled";
    await write(rexDir, model);

    expect(await readFile(statePath, "utf-8")).toContain("    futureField: 'kept'\n");
    expect(await readFile(join(rexDir, "changes/add-apple-pay/index.md"), "utf-8")).not.toContain("futureField");
  });

  describe("a state field this build does not know, on a node whose row changes folder", () => {
    const APPLE_PAY_STATE = "changes/add-apple-pay/state.yaml";
    // A row new to its file is serialized afresh, so the hand-written single quotes become double.
    const MOVED_ROW = `  "${TASK}":\n    status: "in_progress"\n    futureField: "kept"\n`;

    /** Give TASK a state row holding `futureField`; returns the file's original text. */
    async function addFutureField(rexDir: string): Promise<string> {
      const path = join(rexDir, APPLE_PAY_STATE);
      const original = await readFile(path, "utf-8");
      await writeFile(path, `${original}  "${TASK}":\n    status: "in_progress"\n    futureField: 'kept'\n`);
      return original;
    }

    it("keeps it in the destination state.yaml when the node moves to another parent", async () => {
      const rexDir = await copyFixture();
      // A second change to move into, written first so it exists on disk.
      const first = await loadPrdModel(rexDir, quiet);
      first.tree.changes.push({ id: "c-new", type: "change", title: "Spike: wallets", slug: "spike-wallets" } as RuleNode);
      await write(rexDir, first);
      const original = await addFutureField(rexDir);

      const model = await loadPrdModel(rexDir, quiet);
      const from = find(all(model), CHANGE);
      const task = find(all(model), TASK);
      from.children = from.children!.filter((n) => n.id !== TASK);
      find(all(model), "c-new").children = [task];
      await write(rexDir, model);

      const dest = await readFile(join(rexDir, "changes/spike-wallets/state.yaml"), "utf-8");
      expect(dest).toContain(MOVED_ROW);
      const leaf = await readFile(join(rexDir, "changes/spike-wallets/wire-the-button.md"), "utf-8");
      expect(leaf).not.toContain("futureField");
      // The old folder loses the row and nothing else.
      expect(await readFile(join(rexDir, APPLE_PAY_STATE), "utf-8")).toBe(original);

      const reread = await loadPrdModel(rexDir, quiet);
      expect(reread.warnings).toEqual([]);
      expect(find(all(reread), TASK)).toMatchObject({ status: "in_progress", futureField: "kept" });
    });

    it("keeps it in the new folder's state.yaml when a leaf becomes a folder", async () => {
      const rexDir = await copyFixture();
      const original = await addFutureField(rexDir);

      const model = await loadPrdModel(rexDir, quiet);
      find(all(model), TASK).children = [{ id: "s1", type: "subtask", title: "Hide on Chrome", slug: "hide-on-chrome" } as RuleNode];
      await write(rexDir, model);

      const dest = await readFile(join(rexDir, "changes/add-apple-pay/wire-the-button/state.yaml"), "utf-8");
      expect(dest).toContain(MOVED_ROW);
      const index = await readFile(join(rexDir, "changes/add-apple-pay/wire-the-button/index.md"), "utf-8");
      expect(index).not.toContain("futureField");
      expect(await readFile(join(rexDir, APPLE_PAY_STATE), "utf-8")).toBe(original);

      const reread = await loadPrdModel(rexDir, quiet);
      expect(reread.warnings).toEqual([]);
      expect(find(all(reread), TASK)).toMatchObject({ status: "in_progress", futureField: "kept" });
    });
  });

  it("writes a change as a folder even with no tasks", async () => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    model.tree.changes.push({ id: "c-new", type: "change", title: "Spike: wallets", slug: "spike-wallets", spike: true } as RuleNode);
    await write(rexDir, model);

    const files = Object.keys(await snapshot(rexDir));
    expect(files).toContain("changes/spike-wallets/index.md");
    expect(files).not.toContain("changes/spike-wallets.md");
    expect(files).not.toContain("changes/spike-wallets/state.yaml");
  });

  it("moves a leaf into a folder when it gains children, taking its state along", async () => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    const task = find(all(model), TASK);
    task.status = "in_progress";
    task.children = [{ id: "s1", type: "subtask", title: "Hide on Chrome", slug: "hide-on-chrome" } as RuleNode];

    const result = await write(rexDir, model);

    expect(result.removed).toEqual(["changes/add-apple-pay/wire-the-button.md"]);
    const files = Object.keys(await snapshot(rexDir));
    expect(files).toEqual(
      expect.arrayContaining([
        "changes/add-apple-pay/wire-the-button/index.md",
        "changes/add-apple-pay/wire-the-button/hide-on-chrome.md",
        "changes/add-apple-pay/wire-the-button/state.yaml",
      ]),
    );
    const reread = await loadPrdModel(rexDir, quiet);
    expect(reread.warnings).toEqual([]);
    expect(find(all(reread), TASK)).toMatchObject({ status: "in_progress", slug: "wire-the-button" });
    expect(find(all(reread), "s1")).toMatchObject({ status: "pending" });
  });

  it("refuses to delete a node it was not told was removed, and deletes it when told", async () => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    find(all(model), CHANGE).children = [];
    const before = await snapshot(rexDir);

    await expect(write(rexDir, model)).rejects.toThrow(new RegExp(`wire-the-button\\.md holds node ${TASK}`));
    expect(await snapshot(rexDir)).toEqual(before);

    const result = await write(rexDir, model, { removed: new Set([TASK]) });
    expect(result.removed).toEqual(["changes/add-apple-pay/wire-the-button.md"]);
  });

  it("refuses to erase a file the reader skipped", async () => {
    const rexDir = await copyFixture();
    await writeFile(join(rexDir, "changes/add-apple-pay/broken.md"), "---\nid: \"x\"\ntype: \"nonsense\"\n---\n");
    const model = await loadPrdModel(rexDir, quiet);
    await expect(write(rexDir, model)).rejects.toThrow(/broken\.md holds node x/);
  });

  it.each([
    ["missing", undefined],
    ["a path", "a/b"],
    ["dot-led", ".hidden"],
    ["a leaf named index", "index"],
  ])("refuses a %s slug", async (_label, slug) => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    find(all(model), TASK).slug = slug as string;
    await expect(write(rexDir, model)).rejects.toThrow(/no usable slug/);
  });

  it.each(["wire-the-button", "Wire-The-Button"])("refuses a sibling with the slug %s", async (slug) => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    find(all(model), CHANGE).children!.push({ id: "t2", type: "task", title: "Other", slug } as RuleNode);
    await expect(write(rexDir, model)).rejects.toThrow(new RegExp(`share the slug "${slug}"`));
  });

  it("refuses a leaf named Index, which is index.md on a case-insensitive disk", async () => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    find(all(model), TASK).slug = "Index";
    await expect(write(rexDir, model)).rejects.toThrow(/no usable slug/);
  });

  it("deletes only tree files from a stale folder, keeping anything else in it", async () => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    const task = find(all(model), TASK);
    task.children = [{ id: "s1", type: "subtask", title: "Hide on Chrome", slug: "hide-on-chrome", status: "completed" } as RuleNode];
    await write(rexDir, model);
    const folder = join(rexDir, "changes/add-apple-pay/wire-the-button");
    await writeFile(join(folder, "diagram.png"), "not markdown");

    task.children = [];
    const result = await write(rexDir, model, { removed: new Set(["s1"]) });

    expect(result.removed.sort()).toEqual([
      "changes/add-apple-pay/wire-the-button/hide-on-chrome.md",
      "changes/add-apple-pay/wire-the-button/index.md",
      "changes/add-apple-pay/wire-the-button/state.yaml",
    ]);
    expect(await readFile(join(folder, "diagram.png"), "utf-8")).toBe("not markdown");
    expect(Object.keys(await snapshot(rexDir))).toContain("changes/add-apple-pay/wire-the-button.md");
  });

  it("removes a stale folder that held only tree files", async () => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    const task = find(all(model), TASK);
    task.children = [{ id: "s1", type: "subtask", title: "Hide on Chrome", slug: "hide-on-chrome" } as RuleNode];
    await write(rexDir, model);

    task.children = [];
    const result = await write(rexDir, model, { removed: new Set(["s1"]) });

    expect(result.removed).toEqual(["changes/add-apple-pay/wire-the-button"]);
    expect(Object.keys(await snapshot(rexDir)).filter((p) => p.includes("wire-the-button"))).toEqual([
      "changes/add-apple-pay/wire-the-button.md",
    ]);
  });

  it("refuses invalid intent before writing anything", async () => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    find(all(model), CHANGE).title = "Changed";
    (find(all(model), TASK) as Record<string, unknown>).priority = "urgent";
    const before = await snapshot(rexDir);
    await expect(write(rexDir, model)).rejects.toThrow(new RegExp(`${TASK}.*invalid intent: priority`));
    expect(await snapshot(rexDir)).toEqual(before);
  });

  it("refuses outside the PRD lock and on a read-only model", async () => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    await expect(writePrdModel(rexDir, model)).rejects.toThrow(/withTransaction/);

    await writeFile(
      join(rexDir, "product/index.md"),
      (await readFile(join(rexDir, "product/index.md"), "utf-8")).replace('schema: "rex/v2"', 'schema: "rex/v3"'),
    );
    const skewed = await loadPrdModel(rexDir, { ...quiet, ignoreSchemaSkew: true });
    await expect(write(rexDir, skewed)).rejects.toThrow(/Writes are refused/);
  });

  it("refuses a tree restamped past v2 since it was read, whatever its state.yaml files say", async () => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    find(all(model), CHANGE).title = "Changed";
    (find(all(model), TASK) as Record<string, unknown>).status = "completed";
    // A newer ndx restamps the root; the folders' state.yaml stamps still say rex/v2.
    const root = join(rexDir, "product/index.md");
    await writeFile(root, (await readFile(root, "utf-8")).replace('schema: "rex/v2"', 'schema: "rex/v3"'));
    const before = await snapshot(rexDir);
    expect(Object.entries(before).some(([p, t]) => p.endsWith("state.yaml") && t.includes("rex/v2"))).toBe(true);

    await expect(write(rexDir, model)).rejects.toThrow(
      /PRD schema is rex\/v3 \(.*index\.md\), this ndx understands up to rex\/v2: upgrade ndx/,
    );
    expect(await snapshot(rexDir)).toEqual(before);
  });

  it("refuses a product folder whose root index.md has gone, as the reader does", async () => {
    const rexDir = await copyFixture();
    const model = await loadPrdModel(rexDir, quiet);
    await rm(join(rexDir, "product/index.md"));
    const before = await snapshot(rexDir);
    await expect(write(rexDir, model)).rejects.toThrow(/PRD schema is missing/);
    expect(await snapshot(rexDir)).toEqual(before);
  });
});
