/**
 * The `attribution` setting through the MCP writers on a v2 tree: with
 * `none`, `add_item` and a status change leave no `lastModifiedBy` in any
 * tracked PRD file; with no setting the stamp is `Name <email>`, as before.
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
import { createStore, resolveStore } from "../../src/store/index.js";
import { handleAddItem, handleUpdateTaskStatus } from "../../src/cli/mcp-tools/index.js";
import { _resetActorCacheForTests } from "../../src/core/identity.js";
import { copyV2Fixture } from "../helpers/v2-fixture.js";

const CHANGE = "c0000000-0000-4000-8000-000000000001";

let tmp: string;
let rexDir: string;
beforeEach(async () => {
  _resetActorCacheForTests();
  mockExecStdout.mockImplementation(async (_cmd: string, args: string[]) =>
    ({ "user.name": "Ada Lovelace", "user.email": "ada@example.com" } as Record<string, string>)[args[args.length - 1]] ?? "",
  );
  tmp = await mkdtemp(join(tmpdir(), "rex-v2-attribution-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function addTaskAndStart(): Promise<void> {
  const added = await handleAddItem(createStore("file", rexDir), tmp, rexDir, { type: "task", title: "Attributed task", parentId: CHANGE });
  expect(added.isError).toBeFalsy();
  const { id } = JSON.parse(added.content[0].text);
  const started = await handleUpdateTaskStatus(await resolveStore(rexDir), tmp, { id, status: "in_progress" });
  expect(started.isError).toBeFalsy();
}

/** Every file under the tracked PRD roots; the execution log is machine-local and keeps its actor. */
async function prdText(): Promise<string> {
  const texts: string[] = [];
  for (const root of ["product", "changes"]) {
    const files = await readdir(join(rexDir, root), { recursive: true, withFileTypes: true });
    for (const f of files) if (f.isFile()) texts.push(await readFile(join(f.parentPath, f.name), "utf-8"));
  }
  return texts.join("\n");
}

describe("attribution through add_item and update_task_status (v2)", () => {
  it("with no setting, stamps Name <email>", async () => {
    await addTaskAndStart();
    expect(await prdText()).toContain("lastModifiedBy: \"Ada Lovelace <ada@example.com>\"");
  });

  it("with attribution none, writes no lastModifiedBy to any file", async () => {
    await writeFile(join(tmp, ".n-dx.json"), JSON.stringify({ rex: { attribution: "none" } }));
    await addTaskAndStart();
    const text = await prdText();
    expect(text).toContain("lastModified:");
    expect(text).not.toContain("lastModifiedBy");
    expect(text).not.toContain("ada@example.com");
  });
});
