/**
 * The contextNotes temp file's lifecycle: a failed write leaves nothing, removals
 * are awaitable, and stale `ndx-context-*` directories are swept.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, utimes, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { failWrite } = vi.hoisted(() => ({ failWrite: { on: false } }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) => {
      if (failWrite.on) return Promise.reject(Object.assign(new Error("ENOSPC: no space left"), { code: "ENOSPC" }));
      return actual.writeFile(...args);
    },
  };
});

import {
  STALE_CONTEXT_DIR_MS,
  settleContextNotesRemovals,
  sweepStaleContextNotes,
  writeContextNotesFile,
} from "../../../src/server/run-options.js";

const contextDirs = async (): Promise<string[]> =>
  (await readdir(tmpdir())).filter((n) => n.startsWith("ndx-context-"));

describe("writeContextNotesFile", () => {
  afterEach(() => { failWrite.on = false; });

  it("removes the directory it made when the write fails", async () => {
    const before = new Set(await contextDirs());
    failWrite.on = true;
    await expect(writeContextNotesFile("notes")).rejects.toThrow("ENOSPC");
    expect((await contextDirs()).filter((n) => !before.has(n))).toEqual([]);
  });

  it("settleContextNotesRemovals waits for a removal in flight", async () => {
    const file = await writeContextNotesFile("notes");
    void file.remove();
    await settleContextNotesRemovals();
    expect(existsSync(file.path)).toBe(false);
  });
});

describe("sweepStaleContextNotes", () => {
  let root: string;
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("removes ndx-context-* directories older than the cutoff and nothing else", async () => {
    root = await mkdtemp(join(tmpdir(), "sweep-test-"));
    const old = new Date(Date.now() - STALE_CONTEXT_DIR_MS - 60_000);
    for (const name of ["ndx-context-old", "unrelated-old"]) {
      await mkdir(join(root, name));
      await utimes(join(root, name), old, old);
    }
    await mkdir(join(root, "ndx-context-fresh"));
    await writeFile(join(root, "ndx-context-file"), "not a directory");

    expect(await sweepStaleContextNotes(STALE_CONTEXT_DIR_MS, root)).toBe(1);
    expect((await readdir(root)).sort()).toEqual(["ndx-context-file", "ndx-context-fresh", "unrelated-old"]);
  });
});
