import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdSync } from "../../../../src/cli/commands/sync.js";
import { getDefaultRegistry, resetDefaultRegistry } from "../../../../src/store/adapter-registry.js";
import { FileStore } from "../../../../src/store/file-adapter.js";
import { toCanonicalJSON } from "../../../../src/core/canonical.js";
import { readPRD, writePRD } from "../../../helpers/rex-dir-test-support.js";
import type { PRDDocument } from "../../../../src/schema/index.js";

const VALID_CONFIG = {
  schema: "rex/v1",
  project: "test-sync",
  adapter: "file",
};

const EMPTY_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Test Project",
  items: [],
};

const POPULATED_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Test Project",
  items: [
    {
      id: "e1",
      title: "Auth System",
      level: "epic",
      status: "pending",
    },
  ],
};

function writeRexConfig(dir: string, config: Record<string, unknown>): void {
  writeFileSync(join(dir, ".rex", "config.json"), toCanonicalJSON(config));
}

function seedDir(dir: string, prd: PRDDocument = EMPTY_PRD): void {
  mkdirSync(join(dir, ".rex"), { recursive: true });
  writeRexConfig(dir, VALID_CONFIG);
  writePRD(dir, prd);
  writeFileSync(join(dir, ".rex", "execution-log.jsonl"), "", "utf-8");
  writeFileSync(join(dir, ".rex", "workflow.md"), "# Workflow", "utf-8");
}

describe("cmdSync", () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-sync-test-"));
    resetDefaultRegistry();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    resetDefaultRegistry();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("throws CLIError when adapter is not configured", async () => {
    seedDir(tmpDir);

    await expect(cmdSync(tmpDir, {})).rejects.toThrow(/not configured/i);
  });

  it("throws CLIError with helpful hint for unconfigured adapter", async () => {
    seedDir(tmpDir);

    try {
      await cmdSync(tmpDir, { adapter: "notion" });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      const e = err as { suggestion?: string };
      expect(e.suggestion).toContain("rex adapter add");
    }
  });

  it("calls engine.push() when --push flag is set", async () => {
    seedDir(tmpDir, POPULATED_PRD);

    // Set up a remote "adapter" that's actually another FileStore
    const remoteDir = mkdtempSync(join(tmpdir(), "rex-sync-remote-"));
    seedDir(remoteDir);

    const registry = getDefaultRegistry();
    registry.register({
      name: "test-remote",
      description: "Test remote",
      configSchema: { dir: { required: true, description: "Remote dir" } },
      factory: (_, config) => new FileStore(join(config.dir as string, ".rex")),
    });
    await registry.saveAdapterConfig(join(tmpDir, ".rex"), {
      name: "test-remote",
      config: { dir: remoteDir },
    });

    await cmdSync(tmpDir, { push: "true", adapter: "test-remote" });

    // Verify push happened — remote should now have the item
    const remoteDoc = readPRD(remoteDir);
    expect(remoteDoc.items.length).toBeGreaterThan(0);
    expect(remoteDoc.items[0].id).toBe("e1");

    rmSync(remoteDir, { recursive: true, force: true });
  });

  it("calls engine.pull() when --pull flag is set", async () => {
    seedDir(tmpDir);

    // Set up a remote with items
    const remoteDir = mkdtempSync(join(tmpdir(), "rex-sync-remote-"));
    seedDir(remoteDir, POPULATED_PRD);

    const registry = getDefaultRegistry();
    registry.register({
      name: "test-remote",
      description: "Test remote",
      configSchema: { dir: { required: true, description: "Remote dir" } },
      factory: (_, config) => new FileStore(join(config.dir as string, ".rex")),
    });
    await registry.saveAdapterConfig(join(tmpDir, ".rex"), {
      name: "test-remote",
      config: { dir: remoteDir },
    });

    await cmdSync(tmpDir, { pull: "true", adapter: "test-remote" });

    // Verify pull happened — local should now have the item
    const localDoc = readPRD(tmpDir);
    expect(localDoc.items.length).toBeGreaterThan(0);
    expect(localDoc.items[0].id).toBe("e1");

    rmSync(remoteDir, { recursive: true, force: true });
  });

  it("calls engine.sync() by default (bidirectional)", async () => {
    seedDir(tmpDir, {
      schema: "rex/v1",
      title: "Local",
      items: [{ id: "local-1", title: "Local Task", level: "task", status: "pending" }],
    });

    const remoteDir = mkdtempSync(join(tmpdir(), "rex-sync-remote-"));
    seedDir(remoteDir, {
      schema: "rex/v1",
      title: "Remote",
      items: [{ id: "remote-1", title: "Remote Task", level: "task", status: "pending" }],
    });

    const registry = getDefaultRegistry();
    registry.register({
      name: "test-remote",
      description: "Test remote",
      configSchema: { dir: { required: true, description: "Remote dir" } },
      factory: (_, config) => new FileStore(join(config.dir as string, ".rex")),
    });
    await registry.saveAdapterConfig(join(tmpDir, ".rex"), {
      name: "test-remote",
      config: { dir: remoteDir },
    });

    await cmdSync(tmpDir, { adapter: "test-remote" });

    // Both should now have both items
    const localDoc = readPRD(tmpDir);
    const remoteDoc = readPRD(remoteDir);

    const localIds = localDoc.items.map((i: { id: string }) => i.id).sort();
    const remoteIds = remoteDoc.items.map((i: { id: string }) => i.id).sort();
    expect(localIds).toEqual(["local-1", "remote-1"]);
    expect(remoteIds).toEqual(["local-1", "remote-1"]);

    rmSync(remoteDir, { recursive: true, force: true });
  });

  it("logs sync_completed event", async () => {
    seedDir(tmpDir, POPULATED_PRD);

    const remoteDir = mkdtempSync(join(tmpdir(), "rex-sync-remote-"));
    seedDir(remoteDir);

    const registry = getDefaultRegistry();
    registry.register({
      name: "test-remote",
      description: "Test remote",
      configSchema: { dir: { required: true, description: "Remote dir" } },
      factory: (_, config) => new FileStore(join(config.dir as string, ".rex")),
    });
    await registry.saveAdapterConfig(join(tmpDir, ".rex"), {
      name: "test-remote",
      config: { dir: remoteDir },
    });

    await cmdSync(tmpDir, { push: "true", adapter: "test-remote" });

    const logContent = readFileSync(join(tmpDir, ".rex", "execution-log.jsonl"), "utf-8");
    const lines = logContent.trim().split("\n").filter(Boolean);
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    expect(lastEntry.event).toBe("sync_completed");
    expect(lastEntry.detail).toContain("push");

    rmSync(remoteDir, { recursive: true, force: true });
  });

  it("outputs JSON when --format=json", async () => {
    seedDir(tmpDir, POPULATED_PRD);

    const remoteDir = mkdtempSync(join(tmpdir(), "rex-sync-remote-"));
    seedDir(remoteDir);

    const registry = getDefaultRegistry();
    registry.register({
      name: "test-remote",
      description: "Test remote",
      configSchema: { dir: { required: true, description: "Remote dir" } },
      factory: (_, config) => new FileStore(join(config.dir as string, ".rex")),
    });
    await registry.saveAdapterConfig(join(tmpDir, ".rex"), {
      name: "test-remote",
      config: { dir: remoteDir },
    });

    await cmdSync(tmpDir, { push: "true", adapter: "test-remote", format: "json" });

    // Find the JSON output in console.log calls
    const jsonCall = logSpy.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(c[0]);
        return parsed.direction !== undefined;
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();

    const report = JSON.parse(jsonCall![0]);
    expect(report.direction).toBe("push");
    expect(report.pushed).toBeInstanceOf(Array);
    expect(report.pulled).toBeInstanceOf(Array);
    expect(report.skipped).toBeInstanceOf(Array);
    expect(report.conflicts).toBeInstanceOf(Array);
    expect(report.timestamp).toBeDefined();

    rmSync(remoteDir, { recursive: true, force: true });
  });

  it("dry-run does not write changes", async () => {
    seedDir(tmpDir, POPULATED_PRD);

    const remoteDir = mkdtempSync(join(tmpdir(), "rex-sync-remote-"));
    seedDir(remoteDir);

    const registry = getDefaultRegistry();
    registry.register({
      name: "test-remote",
      description: "Test remote",
      configSchema: { dir: { required: true, description: "Remote dir" } },
      factory: (_, config) => new FileStore(join(config.dir as string, ".rex")),
    });
    await registry.saveAdapterConfig(join(tmpDir, ".rex"), {
      name: "test-remote",
      config: { dir: remoteDir },
    });

    await cmdSync(tmpDir, { "dry-run": "true", adapter: "test-remote" });

    // Remote should still be empty
    const remoteDoc = readPRD(remoteDir);
    expect(remoteDoc.items).toEqual([]);

    rmSync(remoteDir, { recursive: true, force: true });
  });
});
