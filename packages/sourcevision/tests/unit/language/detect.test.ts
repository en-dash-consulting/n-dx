import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectLanguage, getLanguageConfig, VALID_LANGUAGE_IDS } from "../../../src/language/index.js";
import { typescriptConfig } from "../../../src/language/typescript.js";
import { goConfig } from "../../../src/language/go.js";

describe("detectLanguage", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-detect-"));
  });

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  // ── .n-dx.json override ──────────────────────────────────────────────

  it("returns Go config when .n-dx.json language is 'go'", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ language: "go" }));
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("go");
    expect(config).toBe(goConfig);
  });

  it("returns TypeScript config when .n-dx.json language is 'typescript'", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ language: "typescript" }));
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
    expect(config).toBe(typescriptConfig);
  });

  it("returns TypeScript config when .n-dx.json language is 'javascript'", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ language: "javascript" }));
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
    expect(config).toBe(typescriptConfig);
  });

  it("falls through to auto-detection when language is 'auto'", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ language: "auto" }));
    await writeFile(join(tmpDir, "go.mod"), "module example.com/test\n");
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("go");
  });

  it("falls through to auto-detection when language field is omitted", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }));
    await writeFile(join(tmpDir, "package.json"), "{}");
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
  });

  it("falls through to auto-detection for unknown language id", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ language: "rust" }));
    // No markers → falls back to TypeScript
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
  });

  // ── Marker-based detection ───────────────────────────────────────────

  it("detects Go from go.mod when no package.json exists", async () => {
    await writeFile(join(tmpDir, "go.mod"), "module example.com/test\n");
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("go");
  });

  it("detects TypeScript from package.json when no go.mod exists", async () => {
    await writeFile(join(tmpDir, "package.json"), "{}");
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
  });

  it("falls back to TypeScript when no markers exist", async () => {
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
  });

  // ── Override takes priority over markers ──────────────────────────────

  it("override 'go' takes priority even when package.json exists", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ language: "go" }));
    await writeFile(join(tmpDir, "package.json"), "{}");
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("go");
  });

  it("override 'typescript' takes priority even when go.mod exists", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ language: "typescript" }));
    await writeFile(join(tmpDir, "go.mod"), "module example.com/test\n");
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
  });
});

describe("VALID_LANGUAGE_IDS", () => {
  it("contains the four expected values", () => {
    expect(VALID_LANGUAGE_IDS).toEqual(["typescript", "javascript", "go", "auto"]);
  });
});

describe("getLanguageConfig", () => {
  it("returns Go config for 'go'", () => {
    expect(getLanguageConfig("go")).toBe(goConfig);
  });

  it("returns TypeScript config for 'typescript'", () => {
    expect(getLanguageConfig("typescript")).toBe(typescriptConfig);
  });

  it("returns TypeScript config for 'javascript'", () => {
    expect(getLanguageConfig("javascript")).toBe(typescriptConfig);
  });

  it("returns undefined for unknown ids", () => {
    expect(getLanguageConfig("rust")).toBeUndefined();
    expect(getLanguageConfig("auto")).toBeUndefined();
  });
});
