import { describe, it, expect, afterEach } from "vitest";
import { setLLMConfig } from "../../../src/analyzers/claude-client.js";
import { resolveVendorModel, NEWEST_MODELS } from "@n-dx/llm-client";
import { resolveAnalyzeTokenEventMetadata, classifyPrMarkdownError } from "../../../src/cli/commands/analyze.js";

describe("analyze token usage metadata", () => {
  afterEach(() => {
    setLLMConfig({});
  });

  it("uses configured codex model when present", () => {
    const llmConfig = {
      vendor: "codex",
      codex: { model: "gpt-5-codex-custom" },
    } as const;
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata).toEqual({
      vendor: "codex",
      model: "gpt-5-codex-custom",
    });
  });

  it("falls back to resolveVendorModel default when codex model is not configured", () => {
    const llmConfig = { vendor: "codex", codex: {} } as const;
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata).toEqual({
      vendor: "codex",
      model: resolveVendorModel("codex", llmConfig),
    });
  });

  it("falls back to resolveVendorModel default when claude model is not configured", () => {
    const llmConfig = { vendor: "claude", claude: {} } as const;
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata).toEqual({
      vendor: "claude",
      model: resolveVendorModel("claude", llmConfig),
    });
  });

  it("reflects configured claude model from .n-dx.json", () => {
    const llmConfig = { vendor: "claude", claude: { model: "claude-opus-4-20250514" } } as const;
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata.model).toBe("claude-opus-4-20250514");
  });

  it("reflects configured codex model from .n-dx.json", () => {
    const llmConfig = { vendor: "codex", codex: { model: "gpt-5.1-codex-mini" } } as const;
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata.model).toBe("gpt-5.1-codex-mini");
  });

  it("vendor switch changes resolved model", () => {
    const claudeConfig = { vendor: "claude", claude: {} } as const;
    setLLMConfig(claudeConfig);
    const claudeMetadata = resolveAnalyzeTokenEventMetadata(claudeConfig);

    const codexConfig = { vendor: "codex", codex: {} } as const;
    setLLMConfig(codexConfig);
    const codexMetadata = resolveAnalyzeTokenEventMetadata(codexConfig);

    expect(claudeMetadata.vendor).toBe("claude");
    expect(codexMetadata.vendor).toBe("codex");
    expect(claudeMetadata.model).toBe(resolveVendorModel("claude", claudeConfig));
    expect(codexMetadata.model).toBe(resolveVendorModel("codex", codexConfig));
    expect(claudeMetadata.model).not.toBe(codexMetadata.model);
  });
});

describe("classifyPrMarkdownError", () => {
  it("detects permission denied errors (EACCES)", () => {
    const err = new Error("EACCES: permission denied, open '/foo/.sourcevision/pr-markdown.md'");
    const result = classifyPrMarkdownError(err);
    expect(result).toContain("Permission denied");
    expect(result).toContain(".sourcevision/");
  });

  it("detects permission denied errors (EPERM)", () => {
    const err = new Error("EPERM: operation not permitted, open '/foo/.sourcevision/pr-markdown.md'");
    const result = classifyPrMarkdownError(err);
    expect(result).toContain("Permission denied");
  });

  it("detects disk full errors", () => {
    const err = new Error("ENOSPC: no space left on device");
    const result = classifyPrMarkdownError(err);
    expect(result).toContain("Disk full");
  });

  it("detects missing .sourcevision directory", () => {
    const err = new Error("ENOENT: no such file or directory, open '/foo/.sourcevision/pr-markdown.md'");
    const result = classifyPrMarkdownError(err);
    expect(result).toContain(".sourcevision/");
    expect(result).toContain("sourcevision init");
  });

  it("detects generic ENOENT errors", () => {
    const err = new Error("ENOENT: no such file or directory, open '/foo/bar/baz.json'");
    const result = classifyPrMarkdownError(err);
    expect(result).toContain("sourcevision init");
  });

  it("provides fallback guidance for unknown errors", () => {
    const err = new Error("Unexpected token in JSON");
    const result = classifyPrMarkdownError(err);
    expect(result).toContain("Unexpected token in JSON");
    expect(result).toContain("sourcevision analyze");
  });

  it("handles non-Error values", () => {
    const result = classifyPrMarkdownError("string error");
    expect(result).toContain("string error");
    expect(result).toContain("sourcevision analyze");
  });

  it("handles null/undefined errors", () => {
    const result = classifyPrMarkdownError(null);
    expect(result).toContain("sourcevision analyze");
  });
});
