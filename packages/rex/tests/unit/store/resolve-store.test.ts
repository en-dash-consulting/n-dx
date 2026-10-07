/**
 * Tests for resolveStore and createStore.
 *
 * resolveStore always returns a FileStore — the local file store is the
 * primary store for all commands. Its companion `resolveRemoteStore` was
 * removed with the tracker adapters it existed to build.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { resolveStore, createStore } from "../../../src/store/index.js";
import { parseDocument } from "../../../src/store/markdown-parser.js";
import type { PRDStore } from "../../../src/store/contracts.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedRexDir(
  rexDir: string,
  adapter: string = "file",
): Promise<void> {
  await mkdir(rexDir, { recursive: true });
  await writeFile(
    join(rexDir, "prd.md"),
    `---\nschema: ${SCHEMA_VERSION}\ntitle: Test\n---\n\n# Test\n`,
    "utf-8",
  );
  await writeFile(
    join(rexDir, "config.json"),
    toCanonicalJSON({ schema: SCHEMA_VERSION, project: "test", adapter }),
    "utf-8",
  );
  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
  await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveStore", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-resolve-"));
    rexDir = join(tmpDir, ".rex");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ---- Always returns FileStore, whatever the config says -------------------

  it("resolves to FileStore when config.adapter is 'file'", async () => {
    await seedRexDir(rexDir, "file");

    const store = await resolveStore(rexDir);
    expect(store.capabilities().adapter).toBe("file");
  });

  it("resolves to FileStore when config.json is missing", async () => {
    // Create rexDir but no config.json
    await mkdir(rexDir, { recursive: true });
    await writeFile(
      join(rexDir, "prd.md"),
      `---\nschema: ${SCHEMA_VERSION}\ntitle: Test\n---\n\n# Test\n`,
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");

    const store = await resolveStore(rexDir);
    expect(store.capabilities().adapter).toBe("file");
  });

  // `config.adapter` is carried in `.rex/config.json` and reported by
  // `capabilities()`, but resolveStore does not dispatch on it: a checkout whose
  // config still names a removed tracker adapter must open its local tree, not
  // fail. Each value here was a reachable one at some point.
  it.each(["", "notion", "jira", "nonexistent-adapter"])(
    "resolves to FileStore when config.adapter is %o",
    async (adapter) => {
      await seedRexDir(rexDir, adapter);

      const store = await resolveStore(rexDir);
      expect(store.capabilities().adapter).toBe("file");
    },
  );

  // ---- createStore ----------------------------------------------------------

  it("createStore refuses a backend that no longer exists", async () => {
    await seedRexDir(rexDir, "file");

    // "notion" was a real adapter name until the tracker adapters were removed.
    // A caller still asking for one should get an error naming what is left,
    // not a silent FileStore under a name it did not request.
    expect(() => createStore("notion", rexDir)).toThrow(/notion/);
    expect(() => createStore("notion", rexDir)).toThrow(/"file"/);
  });

  // ---- Functional integration: resolved store works correctly ---------------

  it("resolved store can load and save documents", async () => {
    await seedRexDir(rexDir, "file");

    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    expect(doc.schema).toBe(SCHEMA_VERSION);
    expect(doc.items).toEqual([]);

    // Add an item and verify round-trip
    await store.addItem({
      id: "rs-1",
      title: "Resolved Store Task",
      status: "pending",
      level: "task",
    });

    const reloaded = await store.loadDocument();
    expect(reloaded.items).toHaveLength(1);
    expect(reloaded.items[0].title).toBe("Resolved Store Task");
  });

  it("resolved store can load config", async () => {
    await seedRexDir(rexDir, "file");

    const store = await resolveStore(rexDir);
    const config = await store.loadConfig();
    expect(config.project).toBe("test");
    expect(config.adapter).toBe("file");
  });

  // ---- Equivalence with direct createStore ---------------------------------

  it("produces same result as createStore for file adapter", async () => {
    await seedRexDir(rexDir, "file");

    const resolved = await resolveStore(rexDir);
    const direct = createStore("file", rexDir);

    expect(resolved.capabilities()).toEqual(direct.capabilities());

    // Both can load the same document
    const doc1 = await resolved.loadDocument();
    const doc2 = await direct.loadDocument();
    expect(doc1).toEqual(doc2);
  });

  // FileStore mutations write only to .rex/prd_tree/; prd.md is no longer
  // regenerated, so this single-file-mode write contract no longer applies.
  it.skip("writes new root items to prd.md regardless of the current branch (single-file mode)", async () => {
    await mkdir(tmpDir, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: tmpDir, encoding: "utf-8" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir, encoding: "utf-8" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir, encoding: "utf-8" });
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    execFileSync("git", ["checkout", "-b", "feature/test"], { cwd: tmpDir, encoding: "utf-8" });

    await seedRexDir(rexDir, "file");

    const store = await resolveStore(rexDir);
    await store.addItem({
      id: "branch-epic",
      title: "Branch Epic",
      status: "pending",
      level: "epic",
    });

    // All writes land in prd.md; the in-memory currentBranchFile only
    // influences attribution metadata, not the on-disk write target.
    const primaryParsed = parseDocument(
      await readFile(join(rexDir, "prd.md"), "utf-8"),
    );
    if (!primaryParsed.ok) throw primaryParsed.error;
    expect(primaryParsed.data.items.map((item) => item.id)).toEqual(["branch-epic"]);
  });
});
