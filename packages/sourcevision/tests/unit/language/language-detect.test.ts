import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectLanguage } from "../../../src/language/detect.js";
import { goConfig } from "../../../src/language/go.js";
import { typescriptConfig } from "../../../src/language/typescript.js";

describe("language auto-detection", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-lang-detect-"));
  });

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Single-marker detection ──────────────────────────────────────────────

  it("detects Go when only go.mod is present", async () => {
    await writeFile(join(tmpDir, "go.mod"), "module example.com/test\n\ngo 1.21\n");
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("go");
    expect(config).toBe(goConfig);
  });

  it("detects TypeScript when only package.json is present", async () => {
    await writeFile(join(tmpDir, "package.json"), '{"name": "test"}\n');
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
    expect(config).toBe(typescriptConfig);
  });

  it("falls back to TypeScript when neither marker is present", async () => {
    // Empty directory — no go.mod, no package.json
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
    expect(config).toBe(typescriptConfig);
  });

  // ── .n-dx.json override ────────────────────────────────────────────────

  it("override 'go' takes effect even when no go.mod is present", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ language: "go" }));
    // No go.mod in directory — override should still select Go
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("go");
    expect(config).toBe(goConfig);
  });

  it("override 'typescript' takes effect even when go.mod is present", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ language: "typescript" }));
    await writeFile(join(tmpDir, "go.mod"), "module example.com/test\n");
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
    expect(config).toBe(typescriptConfig);
  });

  it("override 'auto' falls through to marker-based detection", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ language: "auto" }));
    await writeFile(join(tmpDir, "go.mod"), "module example.com/test\n");
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("go");
  });

  it("unknown override language falls through to marker-based detection", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ language: "rust" }));
    await writeFile(join(tmpDir, "go.mod"), "module example.com/test\n");
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("go");
  });

  it("missing language field falls through to marker-based detection", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ web: { port: 3000 } }));
    await writeFile(join(tmpDir, "package.json"), "{}");
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
  });

  // ── Both markers present ───────────────────────────────────────────────

  it("uses file-count tiebreak when both go.mod and package.json exist", async () => {
    await writeFile(join(tmpDir, "go.mod"), "module example.com/test\n");
    await writeFile(join(tmpDir, "package.json"), "{}");
    // No source files → counts are 0:0 → TypeScript wins (backward compat)
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
  });
});
