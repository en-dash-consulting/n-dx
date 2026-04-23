/**
 * Tests for the resolveStore and resolveRemoteStore functions.
 *
 * resolveStore always returns a FileStore — the local file store is the
 * primary store for all commands. resolveRemoteStore creates a remote
 * store from adapters.json config, used only by the sync command.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { resolveStore, resolveRemoteStore, createStore } from "../../../src/store/index.js";
import {
  getDefaultRegistry,
  resetDefaultRegistry,
} from "../../../src/store/adapter-registry.js";
import { FileStore } from "../../../src/store/file-adapter.js";
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
    join(rexDir, "prd.json"),
    toCanonicalJSON({ schema: SCHEMA_VERSION, title: "Test", items: [] }),
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
    resetDefaultRegistry();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    resetDefaultRegistry();
  });

  // ---- Default / file adapter ----------------------------------------------

  it("resolves to FileStore when config.adapter is 'file'", async () => {
    await seedRexDir(rexDir, "file");

    const store = await resolveStore(rexDir);
    expect(store.capabilities().adapter).toBe("file");
  });

  it("resolves to FileStore when config.json is missing", async () => {
    // Create rexDir but no config.json
    await mkdir(rexDir, { recursive: true });
    await writeFile(
      join(rexDir, "prd.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, title: "Test", items: [] }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");

    const store = await resolveStore(rexDir);
    expect(store.capabilities().adapter).toBe("file");
  });

  it("resolves to FileStore when config.adapter is empty", async () => {
    await seedRexDir(rexDir, "");

    const store = await resolveStore(rexDir);
    expect(store.capabilities().adapter).toBe("file");
  });

  it("resolves to FileStore for unknown adapter in config", async () => {
    await seedRexDir(rexDir, "nonexistent-adapter");

    const store = await resolveStore(rexDir);
    // Falls back to file adapter
    expect(store.capabilities().adapter).toBe("file");
  });

  // ---- Always returns FileStore regardless of config -----------------------

  it("resolves to FileStore even when config.adapter is a custom adapter", async () => {
    const registry = getDefaultRegistry();
    registry.register({
      name: "memory",
      description: "In-memory store for testing",
      configSchema: {},
      factory: (dir) => new FileStore(dir),
    });

    await seedRexDir(rexDir, "memory");

    const store = await resolveStore(rexDir);
    expect(store.capabilities().adapter).toBe("file");
  });

  it("resolves to FileStore even when adapter has required config", async () => {
    const registry = getDefaultRegistry();
    registry.register({
      name: "custom-db",
      description: "Custom DB adapter",
      configSchema: {
        connectionString: { required: true, description: "DB connection string" },
      },
      factory: (dir, config) => new FileStore(dir),
    });

    await seedRexDir(rexDir, "custom-db");

    const store = await resolveStore(rexDir);
    // No longer reads config.adapter — always returns FileStore
    expect(store.capabilities().adapter).toBe("file");
  });

  it("resolves to FileStore when adapter requires config but adapters.json is missing", async () => {
    const registry = getDefaultRegistry();
    registry.register({
      name: "needs-config",
      description: "Requires config",
      configSchema: {
        token: { required: true, description: "API token" },
      },
      factory: (dir) => new FileStore(dir),
    });

    await seedRexDir(rexDir, "needs-config");

    // No longer throws — resolveStore always returns FileStore
    const store = await resolveStore(rexDir);
    expect(store.capabilities().adapter).toBe("file");
  });

  // ---- resolveRemoteStore ---------------------------------------------------

  it("resolveRemoteStore creates store from adapters.json config", async () => {
    const registry = getDefaultRegistry();
    let factoryCalledWith: Record<string, unknown> = {};

    registry.register({
      name: "custom-db",
      description: "Custom DB adapter",
      configSchema: {
        connectionString: { required: true, description: "DB connection string" },
      },
      factory: (dir, config) => {
        factoryCalledWith = config;
        return new FileStore(dir);
      },
    });

    await seedRexDir(rexDir, "file");
    await registry.saveAdapterConfig(rexDir, {
      name: "custom-db",
      config: { connectionString: "postgres://localhost/test" },
    });

    const remote = await resolveRemoteStore(rexDir, "custom-db");
    expect(remote).toBeDefined();
    expect(factoryCalledWith.connectionString).toBe("postgres://localhost/test");
  });

  it("resolveRemoteStore throws when adapter config is missing", async () => {
    await seedRexDir(rexDir, "file");

    await expect(resolveRemoteStore(rexDir, "notion")).rejects.toThrow(/no.*config/i);
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

  it("routes new root items to the current branch's matching PRD file when one exists", async () => {
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
    await writeFile(
      join(rexDir, "prd_feature-test_2025-04-01.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, title: "feature/test", items: [] }),
      "utf-8",
    );

    const store = await resolveStore(rexDir);
    await store.addItem({
      id: "branch-epic",
      title: "Branch Epic",
      status: "pending",
      level: "epic",
    });

    const branchDoc = JSON.parse(
      await readFile(join(rexDir, "prd_feature-test_2025-04-01.json"), "utf-8"),
    ) as { items: Array<{ id: string }> };
    expect(branchDoc.items.map((item) => item.id)).toEqual(["branch-epic"]);

    const primaryDoc = JSON.parse(
      await readFile(join(rexDir, "prd.json"), "utf-8"),
    ) as { items: Array<{ id: string }> };
    expect(primaryDoc.items).toEqual([]);
  });
});
