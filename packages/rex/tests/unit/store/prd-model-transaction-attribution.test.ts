/**
 * The `attribution` setting on the v2 write path: `full` (default) stamps
 * `Name <email>`, `name` the git user name only, `none` no author at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockExecStdout } = vi.hoisted(() => ({ mockExecStdout: vi.fn() }));

vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return { ...actual, execStdout: mockExecStdout };
});

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withPrdModelTransaction } from "../../../src/store/prd-model-transaction.js";
import { loadPrdModel } from "../../../src/store/prd-model-reader.js";
import { _resetActorCacheForTests } from "../../../src/core/identity.js";
import { DEFAULT_CONFIG } from "../../../src/schema/index.js";
import { indexTree, type V2Tree } from "../../../src/schema/v2-rules.js";
import { copyV2Fixture } from "../../helpers/v2-fixture.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const CHANGE = "c0000000-0000-4000-8000-000000000001";
const quiet = { env: {}, warn: () => {} };

function mockGitConfig(values: Record<string, string | undefined>): void {
  mockExecStdout.mockImplementation(async (_cmd: string, args: string[]) => values[args[args.length - 1]] ?? "");
}

let tmp: string;
let rexDir: string;
beforeEach(async () => {
  _resetActorCacheForTests();
  mockGitConfig({ "user.name": "Ada Lovelace", "user.email": "ada@example.com" });
  tmp = await mkdtemp(join(tmpdir(), "rex-attribution-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function setAttribution(value: unknown): Promise<void> {
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ ...DEFAULT_CONFIG("p"), attribution: value }));
}

/** Retitle `id`, and add a new task under the fixture change. */
async function editAndAdd(id: string, title: string): Promise<void> {
  await withPrdModelTransaction(rexDir, (model) => {
    const tree: V2Tree = structuredClone(model.tree);
    const index = indexTree(tree);
    index.resolve(id)!.title = title;
    const change = index.resolve(CHANGE)!;
    change.children = [...(change.children ?? []), { id: "c0000000-0000-4000-8000-0000000000aa", type: "task", slug: "new-task", title: `New ${title}`, status: "pending" } as never];
    return { tree, result: undefined };
  });
}

async function node(id: string) {
  const model = await loadPrdModel(rexDir, quiet);
  return indexTree(model.tree).resolve(id);
}

async function allText(dir: string): Promise<string> {
  const files = await readdir(dir, { recursive: true, withFileTypes: true });
  const texts = await Promise.all(files.filter((f) => f.isFile()).map((f) => readFile(join(f.parentPath, f.name), "utf-8")));
  return texts.join("\n");
}

describe("attribution on v2 writes", () => {
  it("full by default: Name <email>, as before the setting existed", async () => {
    await editAndAdd(CAPABILITY, "Pay by card, renamed");
    expect((await node(CAPABILITY))?.lastModifiedBy).toBe("Ada Lovelace <ada@example.com>");
    expect((await node("c0000000-0000-4000-8000-0000000000aa"))?.lastModifiedBy).toBe("Ada Lovelace <ada@example.com>");
  });

  it("name: the git user name and no email", async () => {
    await setAttribution("name");
    await editAndAdd(CAPABILITY, "Pay by card, renamed");
    expect((await node(CAPABILITY))?.lastModifiedBy).toBe("Ada Lovelace");
    expect(await allText(rexDir)).not.toContain("ada@example.com");
  });

  it("name with only an email set: no author", async () => {
    mockGitConfig({ "user.email": "ada@example.com" });
    await setAttribution("name");
    await editAndAdd(CAPABILITY, "Pay by card, renamed");
    const stamped = await node(CAPABILITY);
    expect(stamped?.lastModified).toBeTruthy();
    expect(stamped?.lastModifiedBy).toBeUndefined();
    expect(await allText(rexDir)).not.toContain("ada@example.com");
  });

  it("none: no lastModifiedBy in any file, lastModified still stamped", async () => {
    await setAttribution("none");
    await editAndAdd(CAPABILITY, "Pay by card, renamed");
    expect((await node(CAPABILITY))?.lastModified).toBeTruthy();
    expect((await node("c0000000-0000-4000-8000-0000000000aa"))?.lastModified).toBeTruthy();
    const text = await allText(rexDir);
    expect(text).not.toContain("lastModifiedBy");
    expect(text).not.toContain("Ada Lovelace");
  });

  it("none leaves an existing stamp as it is", async () => {
    await editAndAdd(CAPABILITY, "First");
    const first = await node(CAPABILITY);
    await setAttribution("none");
    await withPrdModelTransaction(
      rexDir,
      (model) => {
        const tree = structuredClone(model.tree);
        indexTree(tree).resolve(CAPABILITY)!.title = "Second";
        return { tree, result: undefined };
      },
      { now: () => new Date("2099-01-01T00:00:00.000Z") },
    );
    const second = await node(CAPABILITY);
    expect(second?.lastModifiedBy).toBe(first?.lastModifiedBy);
  });

  it("reads the rex section of .n-dx.json, and .n-dx.local.json over it", async () => {
    await writeFile(join(tmp, ".n-dx.json"), JSON.stringify({ rex: { attribution: "none" } }));
    await writeFile(join(tmp, ".n-dx.local.json"), JSON.stringify({ rex: { attribution: "name" } }));
    await editAndAdd(CAPABILITY, "Pay by card, renamed");
    expect((await node(CAPABILITY))?.lastModifiedBy).toBe("Ada Lovelace");
  });

  it("refuses an unknown value rather than ignoring it", async () => {
    await setAttribution("anonymous");
    await expect(editAndAdd(CAPABILITY, "x")).rejects.toThrow(/Invalid rex attribution "anonymous"/);
  });
});
