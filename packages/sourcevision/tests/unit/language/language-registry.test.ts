import { describe, it, expect } from "vitest";
import { goConfig } from "../../../src/language/go.js";
import { typescriptConfig } from "../../../src/language/typescript.js";
import { getLanguageConfig } from "../../../src/language/detect.js";
import type { LanguageConfig } from "../../../src/language/registry.js";

// ── Go config ────────────────────────────────────────────────────────────────

describe("goConfig", () => {
  it("has id 'go'", () => {
    expect(goConfig.id).toBe("go");
  });

  it("includes vendor/ in skipDirectories", () => {
    expect(goConfig.skipDirectories.has("vendor")).toBe(true);
  });

  it("includes _test.go in testFilePatterns", () => {
    const match = goConfig.testFilePatterns.some((p) => p.test("handler_test.go"));
    expect(match).toBe(true);
  });

  it("does not match regular .go files as test files", () => {
    const match = goConfig.testFilePatterns.some((p) => p.test("handler.go"));
    expect(match).toBe(false);
  });

  it("includes go.mod in configFilenames", () => {
    expect(goConfig.configFilenames.has("go.mod")).toBe(true);
  });

  it("includes go.sum in configFilenames", () => {
    expect(goConfig.configFilenames.has("go.sum")).toBe(true);
  });

  it("includes .golangci.yml in configFilenames", () => {
    expect(goConfig.configFilenames.has(".golangci.yml")).toBe(true);
  });

  it("has .go in extensions", () => {
    expect(goConfig.extensions.has(".go")).toBe(true);
  });

  it("has go.mod as moduleFile", () => {
    expect(goConfig.moduleFile).toBe("go.mod");
  });

  it("recognises generated file patterns (_gen.go, .pb.go, wire_gen.go)", () => {
    expect(goConfig.generatedFilePatterns.some((p) => p.test("user_gen.go"))).toBe(true);
    expect(goConfig.generatedFilePatterns.some((p) => p.test("user.pb.go"))).toBe(true);
    expect(goConfig.generatedFilePatterns.some((p) => p.test("wire_gen.go"))).toBe(true);
  });

  it("matches main.go as entry point", () => {
    expect(goConfig.entryPointPatterns.some((p) => p.test("main.go"))).toBe(true);
    expect(goConfig.entryPointPatterns.some((p) => p.test("cmd/api/main.go"))).toBe(true);
  });
});

// ── TypeScript config ────────────────────────────────────────────────────────

describe("typescriptConfig", () => {
  it("has id 'typescript'", () => {
    expect(typescriptConfig.id).toBe("typescript");
  });

  it("includes node_modules/ in skipDirectories", () => {
    expect(typescriptConfig.skipDirectories.has("node_modules")).toBe(true);
  });

  it("includes .test. and .spec. in testFilePatterns", () => {
    const matchTest = typescriptConfig.testFilePatterns.some((p) => p.test("app.test.ts"));
    const matchSpec = typescriptConfig.testFilePatterns.some((p) => p.test("app.spec.ts"));
    expect(matchTest).toBe(true);
    expect(matchSpec).toBe(true);
  });

  it("includes __tests__/ in testFilePatterns", () => {
    const match = typescriptConfig.testFilePatterns.some((p) => p.test("__tests__/app.ts"));
    expect(match).toBe(true);
  });

  it("has package.json as moduleFile", () => {
    expect(typescriptConfig.moduleFile).toBe("package.json");
  });

  it("includes tsconfig.json in configFilenames", () => {
    expect(typescriptConfig.configFilenames.has("tsconfig.json")).toBe(true);
  });

  it("includes package.json in configFilenames", () => {
    expect(typescriptConfig.configFilenames.has("package.json")).toBe(true);
  });

  it("has .ts and .tsx in extensions", () => {
    expect(typescriptConfig.extensions.has(".ts")).toBe(true);
    expect(typescriptConfig.extensions.has(".tsx")).toBe(true);
  });
});

// ── Registry lookup ──────────────────────────────────────────────────────────

describe("getLanguageConfig registry", () => {
  it("returns correct config per language id", () => {
    expect(getLanguageConfig("go")).toBe(goConfig);
    expect(getLanguageConfig("typescript")).toBe(typescriptConfig);
    expect(getLanguageConfig("javascript")).toBe(typescriptConfig);
  });

  it("returns undefined for unsupported languages", () => {
    expect(getLanguageConfig("rust")).toBeUndefined();
    expect(getLanguageConfig("python")).toBeUndefined();
  });

  it("configs satisfy the LanguageConfig interface shape", () => {
    const assertShape = (config: LanguageConfig) => {
      expect(typeof config.id).toBe("string");
      expect(typeof config.displayName).toBe("string");
      expect(config.extensions).toBeInstanceOf(Set);
      expect(config.parseableExtensions).toBeInstanceOf(Set);
      expect(Array.isArray(config.testFilePatterns)).toBe(true);
      expect(config.configFilenames).toBeInstanceOf(Set);
      expect(config.skipDirectories).toBeInstanceOf(Set);
      expect(Array.isArray(config.generatedFilePatterns)).toBe(true);
      expect(Array.isArray(config.entryPointPatterns)).toBe(true);
    };

    assertShape(goConfig);
    assertShape(typescriptConfig);
  });
});
