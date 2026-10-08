import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { typescriptConfig } from "../../src/language/typescript.js";
import { detectLanguages, languageConfigsFromIds, mergeLanguageConfigs } from "../../src/language/detect.js";
import type { Inventory } from "../../src/schema/index.js";

/**
 * A multi-module Maven + Gradle Java repository walked by the real inventory,
 * with auto-detection (no languageConfig override) so the root `pom.xml` must
 * select the Java config. codeOnly:false so non-code config files are kept.
 */
const FILES = [
  "pom.xml",
  "settings.gradle.kts",
  "gradle.properties",
  "gradle/libs.versions.toml",
  "core/pom.xml",
  "core/build.gradle.kts",
  "core/src/main/java/com/acme/core/Order.java",
  "core/src/main/java/com/acme/core/OrderTest.java",
  "core/src/test/java/com/acme/core/OrderService.java",
  "core/src/test/java/com/acme/core/OrderIT.java",
  "web/src/main/java/com/acme/web/DemoApplication.java",
  "web/src/main/resources/application.yml",
  "web/src/main/resources/application-prod.yml",
  "web/src/main/resources/application.properties",
  "web/target/generated-sources/annotations/com/acme/MapperImpl.java",
  "web/build/classes/Foo.java",
  "out/Bar.java",
  ".gradle/cache/Baz.java",
];

describe("analyzeInventory — Java multi-module repository", () => {
  let dir: string;
  let inv: Inventory;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sv-java-inv-"));
    for (const f of FILES) {
      await mkdir(dirname(join(dir, f)), { recursive: true });
      await writeFile(join(dir, f), "");
    }
    inv = await analyzeInventory(dir, { codeOnly: false });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const role = (p: string): string | undefined => inv.files.find((f) => f.path === p)?.role;

  it("classifies Java tests by directory and by name", () => {
    expect(role("core/src/main/java/com/acme/core/OrderTest.java")).toBe("test");
    expect(role("core/src/test/java/com/acme/core/OrderService.java")).toBe("test");
    expect(role("core/src/test/java/com/acme/core/OrderIT.java")).toBe("test");
  });

  it("classifies Maven, Gradle and Spring config", () => {
    for (const p of [
      "pom.xml",
      "core/pom.xml",
      "settings.gradle.kts",
      "core/build.gradle.kts",
      "gradle.properties",
      "gradle/libs.versions.toml",
      "web/src/main/resources/application.yml",
      "web/src/main/resources/application-prod.yml",
      "web/src/main/resources/application.properties",
    ]) {
      expect(role(p), p).toBe("config");
    }
  });

  it("classifies ordinary sources as source", () => {
    expect(role("core/src/main/java/com/acme/core/Order.java")).toBe("source");
    expect(role("web/src/main/java/com/acme/web/DemoApplication.java")).toBe("source");
  });

  it("skips build output and generated-sources directories", () => {
    const paths = inv.files.map((f) => f.path);
    for (const skipped of [
      "web/target/generated-sources/annotations/com/acme/MapperImpl.java",
      "web/build/classes/Foo.java",
      "out/Bar.java",
      ".gradle/cache/Baz.java",
    ]) {
      expect(paths).not.toContain(skipped);
    }
  });
});

describe("analyzeInventory — Java beside another primary language", () => {
  let dir: string;

  const MIXED_FILES = [
    "package.json",
    "pom.xml",
    "src/main/java/com/acme/DemoApplication.java",
    "frontend/src/app.ts",
    "frontend/src/generated/api.ts",
    "frontend/out/bundle.ts",
    "target/classes/Foo.java",
    ".gradle/cache/Baz.java",
  ];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sv-java-mixed-"));
    for (const f of MIXED_FILES) {
      await mkdir(dirname(join(dir, f)), { recursive: true });
      await writeFile(join(dir, f), f === "package.json" ? "{}" : "");
    }
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function inventory(ids?: string[]): Promise<Inventory> {
    const configs = ids ? languageConfigsFromIds(ids) : await detectLanguages(dir);
    return analyzeInventory(dir, { codeOnly: false, languageConfig: mergeLanguageConfigs(configs) });
  }

  it.each([
    ["detected", undefined],
    ["rebuilt from manifest.languages", ["typescript", "java"]],
  ])("keeps TS under generated/ and out/ with its normal role (%s)", async (_n, ids) => {
    const inv = await inventory(ids);
    const tsOnly = await analyzeInventory(dir, { codeOnly: false, languageConfig: typescriptConfig });
    const roles = (i: Inventory, paths: string[]) => paths.map((p) => i.files.find((f) => f.path === p)?.role);
    const tsPaths = ["frontend/src/app.ts", "frontend/src/generated/api.ts", "frontend/out/bundle.ts"];

    // Same inventory entries and roles as the repo would have without pom.xml.
    expect(roles(inv, tsPaths)).toEqual(roles(tsOnly, tsPaths));
    expect(roles(inv, tsPaths)).not.toContain(undefined);
    expect(roles(inv, ["src/main/java/com/acme/DemoApplication.java"])).toEqual(["source"]);
  });

  it("still skips unambiguous Maven and Gradle build output", async () => {
    const paths = (await inventory()).files.map((f) => f.path);
    expect(paths).not.toContain("target/classes/Foo.java");
    expect(paths).not.toContain(".gradle/cache/Baz.java");
  });
});
