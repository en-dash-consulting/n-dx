import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { discoverJavaModules } from "../../../src/language/java-modules.js";

describe("discoverJavaModules", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sv-java-modules-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function file(rel: string, body = ""): Promise<void> {
    const full = join(dir, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  const dirs = (...rels: string[]) => Promise.all(rels.map((r) => file(`${r}/.keep`)));
  const discover = async () => {
    const layout = await discoverJavaModules(dir);
    return { layout, get: (n: string) => layout.modules.find((m) => m.name === n) };
  };

  it("reads a single-module Maven project with only the roots that exist", async () => {
    await file("pom.xml", "<project><artifactId>app</artifactId></project>");
    await dirs("src/main/java");
    const { layout } = await discover();
    expect(layout.buildSystem).toBe("maven");
    expect(layout.modules).toEqual([{ name: "app", dir: "", sourceRoots: ["src/main/java"] }]);
  });

  it("reads Maven modules recursively, ignoring commented-out entries and the parent artifactId", async () => {
    await file(
      "pom.xml",
      `<project><artifactId>root</artifactId>
         <modules><module>core</module><!-- <module>old</module> --><module>services</module></modules></project>`,
    );
    await file(
      "services/pom.xml",
      `<project><parent><artifactId>root</artifactId></parent><artifactId>services</artifactId>
         <modules><module>api</module><module>web/pom.xml</module></modules></project>`,
    );
    await file("core/pom.xml", "<project><artifactId>core</artifactId></project>");
    await file(
      "services/api/pom.xml",
      `<project><artifactId>api</artifactId><build>
         <sourceDirectory>src/gen/java</sourceDirectory>
         <testSourceDirectory>\${project.basedir}/src/it/java</testSourceDirectory>
         <resources>\${other}/x</resources></build></project>`,
    );
    await file("services/web/pom.xml", "<project><artifactId>web</artifactId></project>");
    await dirs(
      "core/src/main/java",
      "core/src/test/java",
      "services/api/src/gen/java",
      "services/api/src/it/java",
      "services/web/src/main/java",
      "old/src/main/java",
    );

    const { layout, get } = await discover();
    expect(layout.modules.map((m) => m.name).sort()).toEqual(["api", "core", "root", "services", "web"]);
    expect(get("core")?.sourceRoots).toEqual(["core/src/main/java", "core/src/test/java"]);
    expect(get("api")).toEqual({
      name: "api",
      dir: "services/api",
      sourceRoots: ["services/api/src/gen/java", "services/api/src/it/java"],
    });
    expect(get("web")?.dir).toBe("services/web");
  });

  it("strips nested comment fragments until none remain, so a hidden module is not read", async () => {
    // One pass removes the inner comment and leaves `<!-- <module>hidden</module> -->` behind.
    await file(
      "pom.xml",
      "<project><artifactId>root</artifactId><modules><module>core</module><!<!-- x -->-- <module>hidden</module> --></modules></project>",
    );
    await file("core/pom.xml", "<project><artifactId>core</artifactId></project>");
    await file("hidden/pom.xml", "<project><artifactId>hidden</artifactId></project>");
    const { layout } = await discover();
    expect(layout.modules.map((m) => m.name).sort()).toEqual(["core", "root"]);
  });

  it("ignores sourceDirectory set in plugin configuration", async () => {
    await file(
      "pom.xml",
      `<project><artifactId>g</artifactId><build><plugins><plugin><artifactId>antlr4-maven-plugin</artifactId>
         <configuration><sourceDirectory>src/main/antlr4</sourceDirectory></configuration></plugin></plugins></build></project>`,
    );
    await dirs("src/main/java", "src/main/antlr4");
    expect((await discoverJavaModules(dir)).modules[0]).toEqual({
      name: "g",
      dir: "",
      sourceRoots: ["src/main/java"],
    });
  });

  it("does not loop on cyclic module references", async () => {
    await file(
      "pom.xml",
      "<project><artifactId>a</artifactId><modules><module>.</module><module>b</module></modules></project>",
    );
    await file("b/pom.xml", "<project><artifactId>b</artifactId><modules><module>..</module></modules></project>");
    expect((await discoverJavaModules(dir)).modules.map((m) => m.name)).toEqual(["a", "b"]);
  });

  it("reads Gradle Kotlin DSL settings, projectDir overrides and srcDirs", async () => {
    await file(
      "settings.gradle.kts",
      `rootProject.name = "demo"
       // include("ignored")
       include(":app", ":libs:util")
       include("renamed")
       project(":renamed").projectDir = file("modules/renamed")`,
    );
    await file("app/build.gradle.kts", `sourceSets { main { java.srcDirs("src/extra/java", "src/main/java") } }`);
    await dirs(
      "app/src/main/java",
      "app/src/extra/java",
      "libs/util/src/test/java",
      "modules/renamed/src/main/java",
      "ignored/src/main/java",
    );

    const { layout, get } = await discover();
    expect(layout.buildSystem).toBe("gradle");
    expect(layout.modules.map((m) => m.name)).toEqual([":", ":app", ":libs", ":libs:util", ":renamed"]);
    expect(get(":app")?.sourceRoots).toEqual(["app/src/main/java", "app/src/extra/java"]);
    expect(get(":libs:util")?.sourceRoots).toEqual(["libs/util/src/test/java"]);
    expect(get(":renamed")?.dir).toBe("modules/renamed");
    expect(get(":renamed")?.sourceRoots).toEqual(["modules/renamed/src/main/java"]);
  });

  it("reads Groovy settings with unparenthesised, multi-line includes and a File override", async () => {
    await file(
      "settings.gradle",
      `include 'a',
        'b'
include ':c'
project(':c').projectDir = new File(settingsDir, 'vendor/c')`,
    );
    await file(
      "a/build.gradle",
      `sourceSets {
  main { java { srcDirs = [
    'gen/java',
    'src/main/java' ] } }
}`,
    );
    await dirs("a/gen/java", "a/src/main/java", "b/src/main/java", "vendor/c/src/main/java");

    const { get } = await discover();
    expect(get(":a")?.sourceRoots).toEqual(["a/src/main/java", "a/gen/java"]);
    expect(get(":b")?.sourceRoots).toEqual(["b/src/main/java"]);
    expect(get(":c")?.dir).toBe("vendor/c");
  });

  it("treats a lone build.gradle as a single root module", async () => {
    await file("build.gradle", "plugins { id 'java' }");
    await dirs("src/main/java");
    expect((await discoverJavaModules(dir)).modules).toHaveLength(1);
  });

  it("falls back to package-declaration roots when there is no build file", async () => {
    await file("server/src/com/acme/App.java", "// header\npackage com.acme;\nclass App {}");
    await file("server/src/com/acme/util/Strings.java", "package com.acme.util;\nclass Strings {}");
    await file("tools/Main.java", "class Main {}");
    await file("build/gen/com/x/Skipped.java", "package com.x;\nclass Skipped {}");
    await file("misc/mismatch/Odd.java", "package some.other;\nclass Odd {}");

    const layout = await discoverJavaModules(dir);
    expect(layout.buildSystem).toBe("none");
    expect(layout.modules).toHaveLength(1);
    expect(layout.modules[0].dir).toBe("");
    expect(layout.modules[0].sourceRoots).toEqual(["server/src", "tools"]);
  });

  it("returns no modules for a directory without Java", async () => {
    await file("README.md", "hi");
    expect(await discoverJavaModules(dir)).toEqual({ buildSystem: "none", modules: [] });
  });
});
