import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadLLMConfig } from "../../src/llm-config.js";

describe("loadLLMConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "llm-client-config-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty config when .n-dx.json is missing", async () => {
    const cfg = await loadLLMConfig(tmpDir);
    expect(cfg).toEqual({});
  });

  it("reads llm.vendor and llm provider sections", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: {
          vendor: "codex",
          codex: { cli_path: "/usr/local/bin/codex", model: "gpt-5-codex" },
          claude: { cli_path: "/usr/local/bin/claude" },
        },
      }, null, 2),
      "utf-8",
    );

    const cfg = await loadLLMConfig(tmpDir);
    expect(cfg.vendor).toBe("codex");
    expect(cfg.codex?.cli_path).toBe("/usr/local/bin/codex");
    expect(cfg.claude?.cli_path).toBe("/usr/local/bin/claude");
  });

  it("falls back to legacy top-level claude config", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        claude: { api_key: "sk-ant-test" },
      }, null, 2),
      "utf-8",
    );

    const cfg = await loadLLMConfig(tmpDir);
    expect(cfg.claude?.api_key).toBe("sk-ant-test");
    expect(cfg.vendor).toBeUndefined();
  });

  it("merges .n-dx.local.json over .n-dx.json (local wins)", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: { vendor: "claude", claude: { model: "claude-sonnet-4-6" } },
      }, null, 2),
      "utf-8",
    );
    await writeFile(
      join(tmpDir, ".n-dx.local.json"),
      JSON.stringify({
        llm: { claude: { cli_path: "/local/claude" } },
      }, null, 2),
      "utf-8",
    );

    const cfg = await loadLLMConfig(tmpDir);
    expect(cfg.vendor).toBe("claude");
    expect(cfg.claude?.cli_path).toBe("/local/claude");
    expect(cfg.claude?.model).toBe("claude-sonnet-4-6");
  });

  it("uses .n-dx.local.json when .n-dx.json is missing", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.local.json"),
      JSON.stringify({
        llm: { vendor: "codex", codex: { cli_path: "/local/codex" } },
      }, null, 2),
      "utf-8",
    );

    const cfg = await loadLLMConfig(tmpDir);
    expect(cfg.vendor).toBe("codex");
    expect(cfg.codex?.cli_path).toBe("/local/codex");
  });

  it("silently ignores invalid .n-dx.local.json", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: { vendor: "claude" },
      }, null, 2),
      "utf-8",
    );
    await writeFile(join(tmpDir, ".n-dx.local.json"), "bad json");

    const cfg = await loadLLMConfig(tmpDir);
    expect(cfg.vendor).toBe("claude");
  });
});
