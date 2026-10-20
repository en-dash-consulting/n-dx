import { describe, it, expect } from "vitest";
import { goConfig } from "../../src/go.js";
import { typescriptConfig } from "../../src/typescript.js";
import { pythonConfig } from "../../src/python.js";
import { javaConfig, javaSecondaryConfig } from "../../src/java.js";
import { getLanguageConfig, mergeLanguageConfigs } from "../../src/detect.js";
import { skipsDirectory, type LanguageConfig } from "../../src/registry.js";

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
    expect(getLanguageConfig("cobol")).toBeUndefined();
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

// ── Conditional skip directories ─────────────────────────────────────────────

describe("skipsDirectory", () => {
  const holdsNothing = () => false;
  const holdsInit = (file: string) => file === "__init__.py";

  it("skips a Python env, build or dist directory unless it is a package", () => {
    for (const name of ["env", "build", "dist"]) {
      expect(skipsDirectory(pythonConfig, name, holdsNothing)).toBe(true);
      expect(skipsDirectory(pythonConfig, name, holdsInit)).toBe(false);
    }
  });

  it("always skips an unconditional name, and never asks about it", () => {
    let asked = false;
    expect(skipsDirectory(pythonConfig, ".venv", () => (asked = true))).toBe(true);
    expect(asked).toBe(false);
  });

  it("keeps a directory no rule names", () => {
    expect(skipsDirectory(pythonConfig, "src", holdsNothing)).toBe(false);
  });

  it("merged with TypeScript, build and dist stay skipped and env stays conditional", () => {
    const merged = mergeLanguageConfigs([pythonConfig, typescriptConfig]);
    expect(skipsDirectory(merged, "dist", holdsInit)).toBe(true);
    expect(skipsDirectory(merged, "build", holdsInit)).toBe(true);
    expect(skipsDirectory(merged, "env", holdsInit)).toBe(false);
    expect(skipsDirectory(merged, "env", holdsNothing)).toBe(true);
  });

  it("a merge with no conditional rules has no skipUnlessContains", () => {
    expect(mergeLanguageConfigs([goConfig, typescriptConfig])).not.toHaveProperty("skipUnlessContains");
    expect(mergeLanguageConfigs([goConfig, typescriptConfig])).not.toHaveProperty("skipBesideMarker");
  });
});

describe("skipsDirectory — build output beside a module root", () => {
  const holdsNothing = () => false;
  const at = (path: string, parentFiles: string[] = []) => ({
    path,
    parentHolds: (file: string) => parentFiles.includes(file),
  });

  it.each(["target", "build", "out", "generated"])("javaConfig skips %s at the project root", (name) => {
    expect(skipsDirectory(javaConfig, name, holdsNothing, at(name))).toBe(true);
  });

  it.each(["pom.xml", "build.gradle", "build.gradle.kts"])("javaConfig skips target beside %s", (marker) => {
    expect(skipsDirectory(javaConfig, "target", holdsNothing, at("sub/target", [marker]))).toBe(true);
  });

  it.each(["target", "build", "out", "generated"])("javaConfig keeps a %s package below src/", (name) => {
    const path = `spring-aop/src/main/java/org/springframework/aop/${name}`;
    expect(skipsDirectory(javaConfig, name, holdsNothing, at(path))).toBe(false);
    // Below src/ even when the parent holds a build file.
    expect(skipsDirectory(javaConfig, name, holdsNothing, at(`src/${name}`, ["pom.xml"]))).toBe(false);
  });

  it("javaConfig keeps a target directory whose parent is not a module root", () => {
    expect(skipsDirectory(javaConfig, "target", holdsNothing, at("docs/target"))).toBe(false);
  });

  it("javaConfig always skips .gradle and generated-sources", () => {
    for (const name of [".gradle", "generated-sources"]) {
      expect(skipsDirectory(javaConfig, name, holdsNothing, at(`src/main/${name}`))).toBe(true);
    }
  });

  it("javaSecondaryConfig applies the same rule to target only", () => {
    expect(skipsDirectory(javaSecondaryConfig, "target", holdsNothing, at("target"))).toBe(true);
    expect(skipsDirectory(javaSecondaryConfig, "target", holdsNothing, at("svc/target", ["pom.xml"]))).toBe(true);
    expect(skipsDirectory(javaSecondaryConfig, "target", holdsNothing, at("svc/src/main/java/a/target"))).toBe(false);
    for (const name of ["build", "out", "generated"]) {
      expect(skipsDirectory(javaSecondaryConfig, name, holdsNothing, at(name))).toBe(false);
    }
  });

  it("without a place, a skipBesideMarker name is skipped as if at the root", () => {
    expect(skipsDirectory(javaConfig, "target", holdsNothing)).toBe(true);
  });

  it("merged with TypeScript, build stays skipped everywhere and target stays conditional", () => {
    const merged = mergeLanguageConfigs([typescriptConfig, javaSecondaryConfig]);
    expect(skipsDirectory(merged, "build", holdsNothing, at("src/main/java/a/build"))).toBe(true);
    expect(skipsDirectory(merged, "target", holdsNothing, at("src/main/java/a/target"))).toBe(false);
    expect(skipsDirectory(merged, "target", holdsNothing, at("target"))).toBe(true);
  });

  it("merged with Python, a directory either language calls source is kept", () => {
    const merged = mergeLanguageConfigs([javaConfig, pythonConfig]);
    const holdsInit = (file: string) => file === "__init__.py";
    // Python package beside a build file: kept.
    expect(skipsDirectory(merged, "build", holdsInit, at("build"))).toBe(false);
    // Java package below src/ without __init__.py: kept.
    expect(skipsDirectory(merged, "build", holdsNothing, at("src/main/java/a/build"))).toBe(false);
    // Neither: skipped.
    expect(skipsDirectory(merged, "build", holdsNothing, at("build"))).toBe(true);
  });
});
