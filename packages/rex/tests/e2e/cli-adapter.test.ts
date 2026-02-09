/**
 * E2E tests for the `rex adapter` CLI command.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "dist",
  "cli",
  "index.js",
);

function run(args: string[], expectFail = false): string {
  try {
    return execFileSync("node", [cliPath, ...args], {
      encoding: "utf-8",
      timeout: 10000,
    });
  } catch (err: unknown) {
    if (expectFail) {
      const e = err as { stderr?: string; stdout?: string };
      return (e.stderr ?? "") + (e.stdout ?? "");
    }
    throw err;
  }
}

describe("rex adapter", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-adapter-"));
    // Initialize .rex/ directory
    run(["init", tmpDir]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ---- Help --------------------------------------------------------------

  it("shows help with --help", () => {
    const output = run(["adapter", "--help", tmpDir]);
    expect(output).toContain("rex adapter");
    expect(output).toContain("list");
    expect(output).toContain("add");
    expect(output).toContain("remove");
    expect(output).toContain("show");
  });

  it("shows help when no subcommand given", () => {
    const output = run(["adapter", tmpDir]);
    expect(output).toContain("rex adapter");
  });

  // ---- List --------------------------------------------------------------

  it("lists built-in adapters", () => {
    const output = run(["adapter", "list", tmpDir]);
    expect(output).toContain("file");
    expect(output).toContain("notion");
    expect(output).toContain("built-in");
  });

  it("lists adapters as JSON", () => {
    const output = run(["adapter", "list", "--format=json", tmpDir]);
    const adapters = JSON.parse(output);
    expect(Array.isArray(adapters)).toBe(true);
    expect(adapters.length).toBeGreaterThanOrEqual(2);

    const file = adapters.find((a: { name: string }) => a.name === "file");
    expect(file).toBeDefined();
    expect(file.builtIn).toBe(true);
  });

  // ---- Add ---------------------------------------------------------------

  it("configures the file adapter", () => {
    const output = run(["adapter", "add", "file", tmpDir]);
    expect(output).toContain('Adapter "file" configured');
  });

  it("configures notion adapter with required fields", () => {
    const output = run([
      "adapter",
      "add",
      "notion",
      "--token=secret_test123",
      "--databaseId=db-abc",
      tmpDir,
    ]);
    expect(output).toContain('Adapter "notion" configured');
  });

  it("fails when required fields are missing", () => {
    const output = run(
      ["adapter", "add", "notion", tmpDir],
      true,
    );
    expect(output).toContain("Missing required config");
    expect(output).toContain("token");
  });

  it("fails for unknown adapter", () => {
    const output = run(
      ["adapter", "add", "nonexistent", tmpDir],
      true,
    );
    expect(output).toContain("Unknown adapter");
  });

  it("persists config to adapters.json", async () => {
    run([
      "adapter",
      "add",
      "notion",
      "--token=secret_test123",
      "--databaseId=db-abc",
      tmpDir,
    ]);

    const raw = await readFile(join(tmpDir, ".rex", "adapters.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data.adapters).toHaveLength(1);
    expect(data.adapters[0].name).toBe("notion");
    // Token is redacted on disk — stored as a marker with env var reference
    expect(data.adapters[0].config.token.__redacted).toBe(true);
    expect(data.adapters[0].config.token.envVar).toBe("REX_NOTION_TOKEN");
    // Non-sensitive fields stored as-is
    expect(data.adapters[0].config.databaseId).toBe("db-abc");
  });

  // ---- Show --------------------------------------------------------------

  it("shows adapter details", () => {
    run([
      "adapter",
      "add",
      "notion",
      "--token=secret_test123",
      "--databaseId=db-abc",
      tmpDir,
    ]);

    const output = run(["adapter", "show", "notion", tmpDir]);
    expect(output).toContain("Adapter: notion");
  });

  it("shows adapter details as JSON", () => {
    run([
      "adapter",
      "add",
      "notion",
      "--token=secret_test123",
      "--databaseId=db-abc",
      tmpDir,
    ]);

    const output = run(["adapter", "show", "notion", "--format=json", tmpDir]);
    const data = JSON.parse(output);
    expect(data.name).toBe("notion");
    expect(data.registered).toBe(true);
    expect(data.configured).toBe(true);
    expect(data.config.databaseId).toBe("db-abc");
  });

  it("shows unconfigured adapter info", () => {
    const output = run(["adapter", "show", "file", tmpDir]);
    expect(output).toContain("Adapter: file");
  });

  // ---- Remove ------------------------------------------------------------

  it("removes adapter config", () => {
    run([
      "adapter",
      "add",
      "notion",
      "--token=secret_test123",
      "--databaseId=db-abc",
      tmpDir,
    ]);

    const output = run(["adapter", "remove", "notion", tmpDir]);
    expect(output).toContain("removed");

    // Verify it's gone
    const listOutput = run(["adapter", "list", "--format=json", tmpDir]);
    const adapters = JSON.parse(listOutput);
    const notion = adapters.find(
      (a: { name: string; configured: boolean }) =>
        a.name === "notion" && a.configured,
    );
    expect(notion).toBeUndefined();
  });

  it("fails when removing unconfigured adapter", () => {
    const output = run(
      ["adapter", "remove", "notion", tmpDir],
      true,
    );
    expect(output).toContain("No configuration found");
  });

  // ---- Multiple adapters -------------------------------------------------

  it("supports multiple configured adapters", async () => {
    run(["adapter", "add", "file", tmpDir]);
    run([
      "adapter",
      "add",
      "notion",
      "--token=secret_test123",
      "--databaseId=db-abc",
      tmpDir,
    ]);

    const raw = await readFile(join(tmpDir, ".rex", "adapters.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data.adapters).toHaveLength(2);

    const listOutput = run(["adapter", "list", "--format=json", tmpDir]);
    const adapters = JSON.parse(listOutput);
    const configured = adapters.filter((a: { configured: boolean }) => a.configured);
    expect(configured).toHaveLength(2);
  });

  // ---- Overwrites --------------------------------------------------------

  it("overwrites existing config on re-add", async () => {
    run([
      "adapter",
      "add",
      "notion",
      "--token=old_token",
      "--databaseId=db-old",
      tmpDir,
    ]);
    run([
      "adapter",
      "add",
      "notion",
      "--token=new_token",
      "--databaseId=db-new",
      tmpDir,
    ]);

    const raw = await readFile(join(tmpDir, ".rex", "adapters.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data.adapters).toHaveLength(1);
    // Token is redacted — only the hint reflects the latest value
    expect(data.adapters[0].config.token.__redacted).toBe(true);
    expect(raw).not.toContain("new_token");
    expect(data.adapters[0].config.databaseId).toBe("db-new");
  });
});
