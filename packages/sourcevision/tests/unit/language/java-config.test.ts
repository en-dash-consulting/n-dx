import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { detectLanguage, detectLanguages, getLanguageConfig, mergeLanguageConfigs } from "../../../src/language/detect.js";
import { javaConfig } from "../../../src/language/java.js";
import { goConfig } from "../../../src/language/go.js";
import { typescriptConfig } from "../../../src/language/typescript.js";
import { classifyRole } from "../../../src/analyzers/inventory.js";

describe("java language config", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sv-java-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function touch(rel: string, body = ""): Promise<void> {
    const full = join(dir, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  it("is registered under the id java", () => {
    expect(getLanguageConfig("java")).toBe(javaConfig);
    expect(javaConfig.extensions.has(".java")).toBe(true);
    expect(javaConfig.moduleFile).toBe("pom.xml");
  });

  describe("detection", () => {
    it.each([
      ["Maven", ["pom.xml"]],
      ["Gradle Groovy", ["build.gradle"]],
      ["Gradle Kotlin DSL", ["build.gradle.kts"]],
      ["Gradle settings only", ["settings.gradle"]],
      ["Gradle Kotlin settings only", ["settings.gradle.kts"]],
      ["Maven multi-module", ["pom.xml", "core/pom.xml", "web/pom.xml"]],
      ["Gradle multi-module", ["settings.gradle.kts", "app/build.gradle.kts", "lib/build.gradle.kts"]],
    ])("detects %s as Java", async (_name, files) => {
      for (const f of files) await touch(f);
      expect(await detectLanguage(dir)).toBe(javaConfig);
      expect(await detectLanguages(dir)).toEqual([javaConfig]);
    });

    it("keeps the existing primary language on mixed repositories", async () => {
      await touch("pom.xml");
      await touch("package.json", "{}");
      expect(await detectLanguage(dir)).toBe(typescriptConfig);
      expect(await detectLanguages(dir)).toEqual([typescriptConfig, javaConfig]);
    });

    it.each(["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"])(
      "adds Java after the other languages when %s sits beside a marker",
      async (build) => {
        await touch(build);
        await touch("go.mod", "module x\n");
        await touch("package.json", "{}");
        const langs = await detectLanguages(dir);
        expect(langs[langs.length - 1]).toBe(javaConfig);
        expect(langs).toContain(goConfig);
        expect(langs).toContain(typescriptConfig);
        expect(langs[0]).toBe(await detectLanguage(dir));
      },
    );

    it("does not add Java without a Maven or Gradle build", async () => {
      await touch("package.json", "{}");
      await touch("src/main/java/com/acme/Foo.java", "class Foo {}");
      expect(await detectLanguages(dir)).toEqual([typescriptConfig]);
    });

    it("keeps Go when go.mod sits beside pom.xml", async () => {
      await touch("pom.xml");
      await touch("go.mod", "module x\n");
      expect(await detectLanguage(dir)).toBe(goConfig);
    });

    it("still falls back to TypeScript with no markers", async () => {
      expect(await detectLanguage(dir)).toBe(typescriptConfig);
    });

    it("honours a .n-dx.json override of java", async () => {
      await touch(".n-dx.json", JSON.stringify({ language: "java" }));
      expect(await detectLanguage(dir)).toBe(javaConfig);
    });
  });

  describe("inventory roles", () => {
    const role = (p: string): string => classifyRole(p, "Java", javaConfig);

    it.each([
      "src/test/java/com/acme/FooBar.java",
      "service/src/test/java/com/acme/Util.java",
      "src/main/java/com/acme/FooTest.java",
      "src/main/java/com/acme/FooTests.java",
      "src/main/java/com/acme/FooIT.java",
    ])("classifies %s as test", (p) => {
      expect(role(p)).toBe("test");
    });

    it.each([
      "target/generated-sources/annotations/com/acme/FooMapperImpl.java",
      "build/generated/sources/openapi/src/main/java/com/acme/Api.java",
      "src/main/generated/com/acme/Gen.java",
      "web/target/generated-sources/Foo.java",
    ])("classifies %s as generated", (p) => {
      expect(role(p)).toBe("generated");
    });

    it.each([
      "pom.xml",
      "core/pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "settings.gradle",
      "settings.gradle.kts",
      "gradle.properties",
      "gradle/libs.versions.toml",
      "src/main/resources/application.properties",
      "src/main/resources/application.yml",
      "src/main/resources/application-prod.yml",
      "src/main/resources/application-local.yaml",
    ])("classifies %s as config", (p) => {
      expect(role(p)).toBe("config");
    });

    it("classifies ordinary sources as source", () => {
      expect(role("src/main/java/com/acme/Foo.java")).toBe("source");
      expect(role("src/main/java/com/acme/Application.java")).toBe("source");
    });

    it("does not treat unrelated yml or toml as Java config", () => {
      expect(role("deploy/application.txt")).not.toBe("config");
      expect(role("other/libs.versions.toml")).not.toBe("config");
    });
  });

  it("keeps configFilePatterns through mergeLanguageConfigs", () => {
    const merged = mergeLanguageConfigs([typescriptConfig, javaConfig]);
    expect(classifyRole("src/main/resources/application-prod.yml", "YAML", merged)).toBe("config");
    expect(mergeLanguageConfigs([typescriptConfig, goConfig]).configFilePatterns).toBeUndefined();
  });

  it("skips build output and generated directories", () => {
    for (const d of ["target", "build", "out", ".gradle", "generated-sources", "generated"]) {
      expect(javaConfig.skipDirectories.has(d)).toBe(true);
    }
  });

  it("matches conventional entry-point file names", () => {
    const hit = (p: string): boolean => javaConfig.entryPointPatterns.some((re) => re.test(p));
    expect(hit("src/main/java/com/acme/DemoApplication.java")).toBe(true);
    expect(hit("src/main/java/com/acme/Main.java")).toBe(true);
    expect(hit("src/main/java/com/acme/Service.java")).toBe(false);
  });
});
