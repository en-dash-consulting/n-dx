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

  it("reads lightModel from llm.claude section", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: {
          claude: {
            model: "claude-sonnet-4-6",
            lightModel: "claude-haiku-4-20250414",
          },
        },
      }, null, 2),
      "utf-8",
    );

    const cfg = await loadLLMConfig(tmpDir);
    expect(cfg.claude?.model).toBe("claude-sonnet-4-6");
    expect(cfg.claude?.lightModel).toBe("claude-haiku-4-20250414");
  });

  it("reads lightModel from llm.codex section", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: {
          codex: {
            model: "gpt-5.5",
            lightModel: "gpt-5.4-mini",
          },
        },
      }, null, 2),
      "utf-8",
    );

    const cfg = await loadLLMConfig(tmpDir);
    expect(cfg.codex?.model).toBe("gpt-5.5");
    expect(cfg.codex?.lightModel).toBe("gpt-5.4-mini");
  });

  it("ignores non-string lightModel values", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: {
          claude: { lightModel: 123 },
          codex: { lightModel: true },
        },
      }, null, 2),
      "utf-8",
    );

    const cfg = await loadLLMConfig(tmpDir);
    expect(cfg.claude?.lightModel).toBeUndefined();
    expect(cfg.codex?.lightModel).toBeUndefined();
  });

  it("ignores empty string lightModel values", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: {
          claude: { lightModel: "", model: "sonnet" },
          codex: { lightModel: "", model: "gpt-5" },
        },
      }, null, 2),
      "utf-8",
    );

    const cfg = await loadLLMConfig(tmpDir);
    expect(cfg.claude?.lightModel).toBeUndefined();
    expect(cfg.claude?.model).toBe("sonnet");
    expect(cfg.codex?.lightModel).toBeUndefined();
    expect(cfg.codex?.model).toBe("gpt-5");
  });
});
