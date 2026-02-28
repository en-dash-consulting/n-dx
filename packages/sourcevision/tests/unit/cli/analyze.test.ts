import { describe, it, expect, afterEach } from "vitest";
import { setLLMConfig, DEFAULT_CODEX_MODEL, DEFAULT_MODEL } from "../../../src/analyzers/claude-client.js";
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

  it("falls back to default codex model when codex model is not configured", () => {
    const llmConfig = { vendor: "codex", codex: {} } as const;
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata).toEqual({
      vendor: "codex",
      model: DEFAULT_CODEX_MODEL,
    });
  });

  it("falls back to default claude model when claude model is not configured", () => {
    const llmConfig = { vendor: "claude", claude: {} } as const;
    setLLMConfig(llmConfig);

    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    expect(metadata).toEqual({
      vendor: "claude",
      model: DEFAULT_MODEL,
    });
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
