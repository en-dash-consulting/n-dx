import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadLLMConfig, resolveVendorModel, NEWEST_MODELS } from "@n-dx/llm-client";
import { setLLMConfig } from "../../src/analyzers/claude-client.js";
import { resolveAnalyzeTokenEventMetadata } from "../../src/cli/commands/analyze.js";

describe("sourcevision analyze respects .n-dx.json model config", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-model-res-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    setLLMConfig({});
  });

  it("uses default claude model when .n-dx.json has no model override", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude" } }),
    );

    const llmConfig = await loadLLMConfig(tmpDir);
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata.vendor).toBe("claude");
    expect(metadata.model).toBe(resolveVendorModel("claude", llmConfig));
  });

  it("changing llm.claude.model in .n-dx.json is reflected in token event metadata", async () => {
    const customModel = "claude-opus-4-20250514";
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude", claude: { model: customModel } } }),
    );

    const llmConfig = await loadLLMConfig(tmpDir);
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata.vendor).toBe("claude");
    expect(metadata.model).toBe(customModel);
  });

  it("changing llm.vendor to codex switches to correct vendor model", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "codex" } }),
    );

    const llmConfig = await loadLLMConfig(tmpDir);
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata.vendor).toBe("codex");
    expect(metadata.model).toBe(resolveVendorModel("codex", llmConfig));
  });

  it("changing llm.codex.model in .n-dx.json is reflected in token event metadata", async () => {
    const customModel = "gpt-5.1-codex-mini";
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "codex", codex: { model: customModel } } }),
    );

    const llmConfig = await loadLLMConfig(tmpDir);
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata.vendor).toBe("codex");
    expect(metadata.model).toBe(customModel);
  });

  it("resolveVendorModel result matches metadata model for both vendors", async () => {
    // Claude with override
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude", claude: { model: "sonnet" } } }),
    );
    let llmConfig = await loadLLMConfig(tmpDir);
    setLLMConfig(llmConfig);

    let metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata.model).toBe(resolveVendorModel("claude", llmConfig));

    // Codex with override
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "codex", codex: { model: "gpt-5.1-codex-max" } } }),
    );
    llmConfig = await loadLLMConfig(tmpDir);
    setLLMConfig(llmConfig);

    metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata.model).toBe(resolveVendorModel("codex", llmConfig));
  });
});
