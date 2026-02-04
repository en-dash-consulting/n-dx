/**
 * Tests for the resolveStore function.
 *
 * resolveStore reads config.json to determine which adapter to use,
 * then creates the appropriate store via the adapter registry. This
 * closes the gap where CLI commands previously hardcoded "file".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { resolveStore, createStore } from "../../../src/store/index.js";
import {
  getDefaultRegistry,
  resetDefaultRegistry,
} from "../../../src/store/adapter-registry.js";
import { FileStore } from "../../../src/store/file-adapter.js";
import type { PRDStore } from "../../../src/store/types.js";

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

  // ---- Custom adapter via registry -----------------------------------------

  it("resolves a custom adapter when registered and no config needed", async () => {
    const registry = getDefaultRegistry();
    registry.register({
      name: "memory",
      description: "In-memory store for testing",
      configSchema: {},
      factory: (dir) => new FileStore(dir), // uses FileStore as stand-in
    });

    await seedRexDir(rexDir, "memory");

    const store = await resolveStore(rexDir);
    // The factory creates a FileStore, but the resolution path is through "memory"
    expect(store).toBeDefined();
  });

  it("resolves adapter with required config from adapters.json", async () => {
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

    await seedRexDir(rexDir, "custom-db");

    // Save adapter config to adapters.json
    await registry.saveAdapterConfig(rexDir, {
      name: "custom-db",
      config: { connectionString: "postgres://localhost/test" },
    });

    const store = await resolveStore(rexDir);
    expect(store).toBeDefined();
    expect(factoryCalledWith.connectionString).toBe("postgres://localhost/test");
  });

  it("throws when adapter requires config but adapters.json is missing", async () => {
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
    // Don't save adapters.json — config is missing

    await expect(resolveStore(rexDir)).rejects.toThrow(/no.*config/i);
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
});
