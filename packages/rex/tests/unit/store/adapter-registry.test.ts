/**
 * Tests for the adapter registration system.
 *
 * The AdapterRegistry allows registering store adapter factories,
 * persisting adapter configurations, and creating stores from registered
 * adapters.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import {
  AdapterRegistry,
  isRedactedField,
  type AdapterDefinition,
  type AdapterConfig,
} from "../../../src/store/adapter-registry.js";
import {
  resolveRemoteStore,
  resolveStore,
  createStore,
} from "../../../src/store/index.js";
import type { PRDStore } from "../../../src/store/contracts.js";
import { FileStore } from "../../../src/store/file-adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock store for testing adapter factories. */
function createMockStore(rexDir: string, config: Record<string, unknown>): PRDStore {
  return new FileStore(rexDir);
}

async function seedRexDir(rexDir: string): Promise<void> {
  await mkdir(rexDir, { recursive: true });
  await writeFile(
    join(rexDir, "prd.json"),
    toCanonicalJSON({ schema: SCHEMA_VERSION, title: "Test", items: [] }),
    "utf-8",
  );
  await writeFile(
    join(rexDir, "config.json"),
    toCanonicalJSON({ schema: SCHEMA_VERSION, project: "test", adapter: "file" }),
    "utf-8",
  );
  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
  await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AdapterRegistry", () => {
  let tmpDir: string;
  let rexDir: string;
  let registry: AdapterRegistry;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-registry-"));
    rexDir = join(tmpDir, ".rex");
    await seedRexDir(rexDir);
    registry = new AdapterRegistry();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ---- Built-in adapters -------------------------------------------------

  describe("built-in adapters", () => {
    it("has 'file' adapter registered by default", () => {
      const adapters = registry.list();
      expect(adapters.some((a) => a.name === "file")).toBe(true);
    });

    it("has 'notion' adapter registered by default", () => {
      const adapters = registry.list();
      expect(adapters.some((a) => a.name === "notion")).toBe(true);
    });

    it("creates a FileStore for the 'file' adapter", () => {
      const store = registry.create("file", rexDir, {});
      expect(store.capabilities().adapter).toBe("file");
    });
  });

  // ---- Registration ------------------------------------------------------

  describe("register", () => {
    it("registers a new adapter", () => {
      const def: AdapterDefinition = {
        name: "custom",
        description: "Custom test adapter",
        configSchema: { token: { required: true, description: "API token" } },
        factory: createMockStore,
      };
      registry.register(def);

      const adapters = registry.list();
      expect(adapters.some((a) => a.name === "custom")).toBe(true);
    });

    it("rejects duplicate adapter names", () => {
      const def: AdapterDefinition = {
        name: "file",
        description: "Duplicate file adapter",
        configSchema: {},
        factory: createMockStore,
      };
      expect(() => registry.register(def)).toThrow(/already registered/);
    });

    it("rejects empty adapter name", () => {
      expect(() =>
        registry.register({
          name: "",
          description: "Empty name",
          configSchema: {},
          factory: createMockStore,
        }),
      ).toThrow(/name/i);
    });
  });

  // ---- Unregister --------------------------------------------------------

  describe("unregister", () => {
    it("removes a registered adapter", () => {
      registry.register({
        name: "removable",
        description: "Will be removed",
        configSchema: {},
        factory: createMockStore,
      });

      registry.unregister("removable");

      const adapters = registry.list();
      expect(adapters.some((a) => a.name === "removable")).toBe(false);
    });

    it("prevents unregistering built-in adapters", () => {
      expect(() => registry.unregister("file")).toThrow(/built-in/);
      expect(() => registry.unregister("notion")).toThrow(/built-in/);
    });

    it("throws for unknown adapter", () => {
      expect(() => registry.unregister("nonexistent")).toThrow(/not found/);
    });
  });

  // ---- Get ---------------------------------------------------------------

  describe("get", () => {
    it("returns definition for registered adapter", () => {
      const def = registry.get("file");
      expect(def).toBeDefined();
      expect(def!.name).toBe("file");
    });

    it("returns undefined for unknown adapter", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  // ---- List --------------------------------------------------------------

  describe("list", () => {
    it("returns all registered adapters with metadata", () => {
      const adapters = registry.list();
      expect(adapters.length).toBeGreaterThanOrEqual(2); // file + notion
      for (const a of adapters) {
        expect(a.name).toBeTruthy();
        expect(a.description).toBeTruthy();
        expect(typeof a.builtIn).toBe("boolean");
      }
    });

    it("marks built-in adapters", () => {
      const adapters = registry.list();
      const fileAdapter = adapters.find((a) => a.name === "file");
      expect(fileAdapter!.builtIn).toBe(true);
    });

    it("marks custom adapters as not built-in", () => {
      registry.register({
        name: "custom",
        description: "Custom",
        configSchema: {},
        factory: createMockStore,
      });

      const adapters = registry.list();
      const custom = adapters.find((a) => a.name === "custom");
      expect(custom!.builtIn).toBe(false);
    });
  });

  // ---- Create store from adapter -----------------------------------------

  describe("create", () => {
    it("creates a store from a registered adapter", () => {
      const store = registry.create("file", rexDir, {});
      expect(store).toBeDefined();
      expect(store.capabilities().adapter).toBe("file");
    });

    it("throws for unknown adapter", () => {
      expect(() => registry.create("nonexistent", rexDir, {})).toThrow(
        /Unknown adapter/,
      );
    });

    it("passes config to the factory", () => {
      let receivedConfig: Record<string, unknown> = {};
      registry.register({
        name: "config-test",
        description: "Config test adapter",
        configSchema: { apiKey: { required: true, description: "API Key" } },
        factory: (dir, config) => {
          receivedConfig = config;
          return createMockStore(dir, config);
        },
      });

      registry.create("config-test", rexDir, { apiKey: "secret-123" });
      expect(receivedConfig).toEqual({ apiKey: "secret-123" });
    });

    it("validates required config fields", () => {
      registry.register({
        name: "requires-token",
        description: "Requires token",
        configSchema: { token: { required: true, description: "Token" } },
        factory: createMockStore,
      });

      expect(() => registry.create("requires-token", rexDir, {})).toThrow(
        /required.*token/i,
      );
    });

    it("allows optional config fields to be missing", () => {
      registry.register({
        name: "optional-fields",
        description: "Has optional fields",
        configSchema: {
          required_field: { required: true, description: "Required" },
          optional_field: { required: false, description: "Optional" },
        },
        factory: createMockStore,
      });

      expect(() =>
        registry.create("optional-fields", rexDir, { required_field: "value" }),
      ).not.toThrow();
    });
  });

  // ---- Config persistence ------------------------------------------------

  describe("adapter config persistence", () => {
    it("saves adapter config to adapters.json", async () => {
      const config: AdapterConfig = {
        name: "notion",
        config: { token: "secret_abc", databaseId: "db-123" },
      };

      await registry.saveAdapterConfig(rexDir, config);

      const raw = await readFile(join(rexDir, "adapters.json"), "utf-8");
      const data = JSON.parse(raw);
      expect(data.adapters).toBeDefined();
      expect(data.adapters).toHaveLength(1);
      expect(data.adapters[0].name).toBe("notion");
    });

    it("loads saved adapter config", async () => {
      await registry.saveAdapterConfig(rexDir, {
        name: "notion",
        config: { token: "secret_abc", databaseId: "db-123" },
      });

      const configs = await registry.loadAdapterConfigs(rexDir);
      expect(configs).toHaveLength(1);
      expect(configs[0].name).toBe("notion");
      expect(configs[0].config.databaseId).toBe("db-123");
    });

    it("supports multiple adapter configs", async () => {
      await registry.saveAdapterConfig(rexDir, {
        name: "notion",
        config: { token: "token-1", databaseId: "db-1" },
      });
      await registry.saveAdapterConfig(rexDir, {
        name: "custom",
        config: { endpoint: "https://api.example.com" },
      });

      const configs = await registry.loadAdapterConfigs(rexDir);
      expect(configs).toHaveLength(2);
      expect(configs.map((c) => c.name).sort()).toEqual(["custom", "notion"]);
    });

    it("overwrites config for the same adapter name", async () => {
      await registry.saveAdapterConfig(rexDir, {
        name: "notion",
        config: { token: "old-token", databaseId: "db-1" },
      });
      await registry.saveAdapterConfig(rexDir, {
        name: "notion",
        config: { token: "new-token", databaseId: "db-2" },
      });

      const configs = await registry.loadAdapterConfigs(rexDir);
      expect(configs).toHaveLength(1);
      // Token is redacted on disk, so the in-memory loaded config has the redacted marker
      expect(isRedactedField(configs[0].config.token)).toBe(true);
      // Non-sensitive fields are stored as-is
      expect(configs[0].config.databaseId).toBe("db-2");
    });

    it("removes adapter config", async () => {
      await registry.saveAdapterConfig(rexDir, {
        name: "notion",
        config: { token: "abc" },
      });
      await registry.saveAdapterConfig(rexDir, {
        name: "custom",
        config: { key: "xyz" },
      });

      await registry.removeAdapterConfig(rexDir, "notion");

      const configs = await registry.loadAdapterConfigs(rexDir);
      expect(configs).toHaveLength(1);
      expect(configs[0].name).toBe("custom");
    });

    it("returns empty array when no adapters.json exists", async () => {
      const configs = await registry.loadAdapterConfigs(rexDir);
      expect(configs).toEqual([]);
    });

    it("does not store tokens in plaintext — redacts sensitive fields", async () => {
      await registry.saveAdapterConfig(rexDir, {
        name: "notion",
        config: { token: "secret_abc123", databaseId: "db-1" },
      });

      const raw = await readFile(join(rexDir, "adapters.json"), "utf-8");
      const data = JSON.parse(raw);

      // Token must NOT appear as plaintext
      expect(raw).not.toContain("secret_abc123");

      // Token is stored as a redacted marker with env var reference
      const tokenField = data.adapters[0].config.token;
      expect(isRedactedField(tokenField)).toBe(true);
      expect(tokenField.__redacted).toBe(true);
      expect(tokenField.envVar).toBe("REX_NOTION_TOKEN");
      expect(tokenField.hint).toMatch(/^secr\*{4}c123$/);

      // Non-sensitive fields are stored as-is
      expect(data.adapters[0].config.databaseId).toBe("db-1");
    });

    it("redacts fields matching well-known sensitive names without schema", async () => {
      // Register an adapter without marking fields as sensitive in schema
      registry.register({
        name: "api-svc",
        description: "API service adapter",
        configSchema: {
          password: { required: true, description: "Service password" },
          host: { required: true, description: "Service host" },
        },
        factory: createMockStore,
      });

      await registry.saveAdapterConfig(rexDir, {
        name: "api-svc",
        config: { password: "hunter2", host: "localhost" },
      });

      const raw = await readFile(join(rexDir, "adapters.json"), "utf-8");
      expect(raw).not.toContain("hunter2");
      expect(raw).toContain("localhost");

      const data = JSON.parse(raw);
      expect(isRedactedField(data.adapters[0].config.password)).toBe(true);
      expect(data.adapters[0].config.host).toBe("localhost");
    });

    it("redacts fields explicitly marked sensitive in schema", async () => {
      registry.register({
        name: "custom-sensitive",
        description: "Custom adapter with sensitive field",
        configSchema: {
          customKey: { required: true, sensitive: true, description: "A secret key" },
          region: { required: true, description: "Region" },
        },
        factory: createMockStore,
      });

      await registry.saveAdapterConfig(rexDir, {
        name: "custom-sensitive",
        config: { customKey: "my-secret-value-12345", region: "us-east-1" },
      });

      const raw = await readFile(join(rexDir, "adapters.json"), "utf-8");
      expect(raw).not.toContain("my-secret-value-12345");

      const data = JSON.parse(raw);
      const keyField = data.adapters[0].config.customKey;
      expect(isRedactedField(keyField)).toBe(true);
      expect(keyField.envVar).toBe("REX_CUSTOM_SENSITIVE_CUSTOM_KEY");
      expect(data.adapters[0].config.region).toBe("us-east-1");
    });

    it("getAdapterConfig returns config for specific adapter", async () => {
      await registry.saveAdapterConfig(rexDir, {
        name: "notion",
        config: { token: "abc", databaseId: "db-1" },
      });
      await registry.saveAdapterConfig(rexDir, {
        name: "custom",
        config: { key: "xyz" },
      });

      const config = await registry.getAdapterConfig(rexDir, "notion");
      expect(config).toBeDefined();
      expect(config!.name).toBe("notion");

      const missing = await registry.getAdapterConfig(rexDir, "nonexistent");
      expect(missing).toBeNull();
    });
  });

  // ---- createFromConfig --------------------------------------------------

  describe("createFromConfig", () => {
    it("creates a store using saved adapter config", async () => {
      await registry.saveAdapterConfig(rexDir, {
        name: "file",
        config: {},
      });

      const store = await registry.createFromConfig(rexDir, "file");
      expect(store.capabilities().adapter).toBe("file");
    });

    it("resolves redacted sensitive fields from environment variables", async () => {
      let receivedConfig: Record<string, unknown> = {};
      registry.register({
        name: "env-test",
        description: "Env var test adapter",
        configSchema: {
          token: { required: true, sensitive: true, description: "API token" },
          endpoint: { required: true, description: "API endpoint" },
        },
        factory: (dir, config) => {
          receivedConfig = config;
          return createMockStore(dir, config);
        },
      });

      // Save config (token will be redacted)
      await registry.saveAdapterConfig(rexDir, {
        name: "env-test",
        config: { token: "my-real-token", endpoint: "https://api.example.com" },
      });

      // Set environment variable
      const envKey = "REX_ENV_TEST_TOKEN";
      const original = process.env[envKey];
      try {
        process.env[envKey] = "resolved-token-from-env";

        const store = await registry.createFromConfig(rexDir, "env-test");
        expect(store).toBeDefined();
        expect(receivedConfig.token).toBe("resolved-token-from-env");
        expect(receivedConfig.endpoint).toBe("https://api.example.com");
      } finally {
        if (original !== undefined) {
          process.env[envKey] = original;
        } else {
          delete process.env[envKey];
        }
      }
    });

    it("throws when env var for sensitive field is not set", async () => {
      await registry.saveAdapterConfig(rexDir, {
        name: "notion",
        config: { token: "secret_test", databaseId: "db-1" },
      });

      // Ensure the env var is not set
      const envKey = "REX_NOTION_TOKEN";
      const original = process.env[envKey];
      try {
        delete process.env[envKey];

        await expect(
          registry.createFromConfig(rexDir, "notion"),
        ).rejects.toThrow(/REX_NOTION_TOKEN.*required/);
      } finally {
        if (original !== undefined) {
          process.env[envKey] = original;
        } else {
          delete process.env[envKey];
        }
      }
    });

    it("throws when no config exists for adapter", async () => {
      await expect(
        registry.createFromConfig(rexDir, "notion"),
      ).rejects.toThrow(/no.*config/i);
    });

    it("throws when adapter is not registered", async () => {
      await registry.saveAdapterConfig(rexDir, {
        name: "unknown-adapter",
        config: {},
      });

      await expect(
        registry.createFromConfig(rexDir, "unknown-adapter"),
      ).rejects.toThrow(/Unknown adapter/);
    });
  });

  // ---- resolveRemoteStore ------------------------------------------------

  describe("resolveRemoteStore", () => {
    it("resolveRemoteStore creates store from adapters.json config", async () => {
      // Save file adapter config (no sensitive fields)
      await registry.saveAdapterConfig(rexDir, {
        name: "file",
        config: {},
      });

      // resolveRemoteStore uses the default registry, so we use the file adapter
      const store = await resolveRemoteStore(rexDir, "file");
      expect(store).toBeDefined();
      expect(store.capabilities().adapter).toBe("file");
    });

    it("resolved store can load and save documents", async () => {
      await registry.saveAdapterConfig(rexDir, {
        name: "file",
        config: {},
      });

      const store = await resolveRemoteStore(rexDir, "file");

      // Load document
      const doc = await store.loadDocument();
      expect(doc.schema).toBe(SCHEMA_VERSION);
      expect(doc.title).toBe("Test");
      expect(doc.items).toEqual([]);

      // Save modified document
      doc.title = "Modified";
      await store.saveDocument(doc);

      // Reload and verify
      const reloaded = await store.loadDocument();
      expect(reloaded.title).toBe("Modified");
    });

    it("resolved store can load config", async () => {
      await registry.saveAdapterConfig(rexDir, {
        name: "file",
        config: {},
      });

      const store = await resolveRemoteStore(rexDir, "file");
      const config = await store.loadConfig();
      expect(config.schema).toBe(SCHEMA_VERSION);
      expect(config.project).toBe("test");
    });

    it("produces same result as createStore for file adapter", async () => {
      await registry.saveAdapterConfig(rexDir, {
        name: "file",
        config: {},
      });

      const resolvedStore = await resolveRemoteStore(rexDir, "file");
      const directStore = createStore("file", rexDir);

      // Both should be FileStores with same capabilities
      expect(resolvedStore.capabilities()).toEqual(directStore.capabilities());

      // Both should read the same data
      const resolvedDoc = await resolvedStore.loadDocument();
      const directDoc = await directStore.loadDocument();
      expect(resolvedDoc).toEqual(directDoc);
    });
  });
});
