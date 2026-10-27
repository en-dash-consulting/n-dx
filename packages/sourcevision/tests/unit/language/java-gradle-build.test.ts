import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { type BuildDependency, type ModuleBuildModel, readGradleBuildModels, discoverJavaModules, GradleScript, parseToml, TomlSyntaxError } from "@n-dx/lang-kit";
import { UPDATE_ENV, updateRequested } from "../../helpers/index.js";

const FIXTURES = fileURLToPath(new URL("../../fixtures/gradle-build", import.meta.url));

async function read(projectDir: string): Promise<ModuleBuildModel[]> {
  const layout = await discoverJavaModules(projectDir);
  return readGradleBuildModels(projectDir, layout.modules);
}

const dep = (m: ModuleBuildModel | undefined, artifact: string, scope?: string): BuildDependency | undefined =>
  m?.dependencies.find((d) => d.artifact === artifact && (scope === undefined || d.scope === scope));
const module = (models: ModuleBuildModel[], name: string): ModuleBuildModel | undefined => models.find((m) => m.module === name);

describe("Gradle build model goldens", () => {
  for (const name of ["groovy-multi", "kotlin-catalog", "computed"]) {
    it(`matches the golden for ${name}`, async () => {
      const text = `${JSON.stringify(await read(join(FIXTURES, name)), null, 2)}\n`;
      const golden = join(FIXTURES, name, "golden.json");
      if (updateRequested()) writeFileSync(golden, text);
      else if (!existsSync(golden)) throw new Error(`No golden at ${golden}; create it with ${UPDATE_ENV}=1`);
      expect(text).toBe(readFileSync(golden, "utf-8"));
    });
  }
});

describe("Gradle build model: Groovy DSL", () => {
  it("reads string, map and platform coordinates, marking script values best-effort", async () => {
    const app = module(await read(join(FIXTURES, "groovy-multi")), ":app");
    expect(dep(app, "guava")).toMatchObject({ group: "com.google.guava", version: { resolved: true, value: "33.2.1-jre", bestEffort: true }, scope: "implementation" });
    expect(dep(app, "commons-lang3")?.version).toEqual({ resolved: true, value: "3.14.0", bestEffort: true });
    expect(dep(app, "spring-cloud-dependencies")?.version).toEqual({ resolved: true, value: "2023.0.1", bestEffort: true });
    expect(dep(app, "junit-jupiter")).toMatchObject({ scope: "testImplementation", version: { resolved: true, value: "5.10.2" } });
    expect(dep(app, "spring-boot-starter-web")?.version).toMatchObject({ resolved: false, reason: expect.stringContaining("no version") });
    expect(app?.dependencies.some((d) => d.group === "")).toBe(false); // project(':lib') is not an external coordinate
  });

  it("leaves an interpolated version unresolved", async () => {
    const app = module(await read(join(FIXTURES, "groovy-multi")), ":app");
    expect(dep(app, "generated")?.version).toEqual({ resolved: false, reason: expect.stringContaining("$generatedVersion") });
  });

  it("reads the toolchain and sourceCompatibility, ignoring commented-out lines", async () => {
    const models = await read(join(FIXTURES, "groovy-multi"));
    expect(module(models, ":app")?.javaVersion).toEqual({ resolved: true, value: "17", bestEffort: true });
    expect(module(models, ":lib")?.javaVersion).toEqual({ resolved: true, value: "11", bestEffort: true });
  });

  it("takes the Spring Boot version from the root plugins block for a module that applies the plugin", async () => {
    const models = await read(join(FIXTURES, "groovy-multi"));
    expect(module(models, ":app")?.springBootVersion).toEqual({ resolved: true, value: "3.2.5", bestEffort: true });
    expect(module(models, ":lib")?.springBootVersion).toBeUndefined();
    expect(module(models, ":")?.group).toEqual({ resolved: true, value: "com.example", bestEffort: true });
  });
});

describe("Gradle build model: Kotlin DSL and version catalog", () => {
  it("resolves libs.* references exactly, with no best-effort flag", async () => {
    const [root] = await read(join(FIXTURES, "kotlin-catalog"));
    expect(dep(root, "spring-boot-starter-web")?.version).toMatchObject({ resolved: false, reason: expect.stringContaining("no version") });
    expect(dep(root, "jackson-module-kotlin")?.version).toEqual({ resolved: true, value: "2.17.2" }); // strictly
    expect(dep(root, "spring-boot-dependencies")?.version).toEqual({ resolved: true, value: "3.3.4" });
    expect(dep(root, "kotlinx-coroutines-core")?.version).toEqual({ resolved: true, value: "1.8.1", bestEffort: true });
  });

  it("expands bundles to their libraries", async () => {
    const [root] = await read(join(FIXTURES, "kotlin-catalog"));
    expect(dep(root, "junit-jupiter-api", "testImplementation")?.version).toEqual({ resolved: true, value: "5.11.0" });
    expect(dep(root, "junit-jupiter-engine", "testImplementation")?.version).toEqual({ resolved: true, value: "5.11.0" });
  });

  it("reports the Spring Boot plugin version from the catalog and the Java version through it", async () => {
    const [root] = await read(join(FIXTURES, "kotlin-catalog"));
    expect(root?.springBootVersion).toEqual({ resolved: true, value: "3.3.4" });
    expect(root?.javaVersion).toEqual({ resolved: true, value: "21" });
  });

  it("notes a reference the catalog lacks, and skips it", async () => {
    const [root] = await read(join(FIXTURES, "kotlin-catalog"));
    expect(root?.notices).toEqual([expect.stringContaining("libs.missing.entry")]);
    expect(root?.dependencies.some((d) => d.artifact === "entry")).toBe(false);
  });

  it("keeps a library whose version.ref dangles, with the version unresolved", async () => {
    const [root] = await read(join(FIXTURES, "kotlin-catalog"));
    expect(dep(root, "broken")?.version).toEqual({ resolved: false, reason: 'version.ref "nowhere" is not in [versions]' });
  });
});

describe("Gradle build model: computed values", () => {
  it("never guesses a value computed at build time", async () => {
    const [root] = await read(join(FIXTURES, "computed"));
    expect(root?.springBootVersion).toMatchObject({ resolved: false, reason: expect.stringContaining("$springBootVersion") });
    expect(root?.javaVersion).toMatchObject({ resolved: false, reason: expect.stringContaining("javaVer") });
    expect(dep(root, "jackson-databind")?.version).toMatchObject({ resolved: false, reason: expect.stringContaining("jacksonVersion") });
    expect(dep(root, "commons-lang3")?.version).toEqual({ resolved: true, value: "3.+", bestEffort: true });
  });

  it("ignores a toolchain inside a conditional and notes unreadable dependencies", async () => {
    const [root] = await read(join(FIXTURES, "computed"));
    expect(root?.javaVersion).not.toEqual(expect.objectContaining({ value: "8" }));
    expect(root?.notices).toEqual(
      expect.arrayContaining([expect.stringContaining("dynamicDependency"), expect.stringContaining("$artifactName")]),
    );
  });
});

describe("Gradle build model: edge cases", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function files(layout: Record<string, string>): Promise<ModuleBuildModel[]> {
    dir = await mkdtemp(join(tmpdir(), "sv-gradle-build-"));
    for (const [rel, body] of Object.entries(layout)) {
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), body);
    }
    return read(dir);
  }

  it("reads Kotlin jvmToolchain and java.sourceCompatibility, toolchain first", async () => {
    const [a] = await files({ "build.gradle.kts": "kotlin { jvmToolchain(21) }\njava.sourceCompatibility = JavaVersion.VERSION_1_8\n" });
    expect(a?.javaVersion).toEqual({ resolved: true, value: "21", bestEffort: true });
    const [b] = await files({ "build.gradle.kts": "java { sourceCompatibility = JavaVersion.VERSION_1_8 }\n" });
    expect(b?.javaVersion).toEqual({ resolved: true, value: "1.8", bestEffort: true });
  });

  it("reads the Spring Boot version from a legacy buildscript classpath", async () => {
    const [m] = await files({
      "build.gradle": `buildscript {\n  dependencies { classpath 'org.springframework.boot:spring-boot-gradle-plugin:2.7.18' }\n}\napply plugin: 'org.springframework.boot'\n`,
    });
    expect(m?.springBootVersion).toEqual({ resolved: true, value: "2.7.18", bestEffort: true });
  });

  it("reports a Spring Boot plugin applied without any version as unresolved", async () => {
    const [m] = await files({ "build.gradle": "plugins { id 'org.springframework.boot' }\n" });
    expect(m?.springBootVersion).toMatchObject({ resolved: false, reason: expect.stringContaining("without a version") });
  });

  it("reads Spring Boot from a BOM dependency when no plugin declares it", async () => {
    const [m] = await files({ "build.gradle": `dependencies { implementation platform("org.springframework.boot:spring-boot-dependencies:3.0.1") }\n` });
    expect(m?.springBootVersion).toEqual({ resolved: true, value: "3.0.1", bestEffort: true });
  });

  it("keeps the module and notes a malformed version catalog", async () => {
    const [m] = await files({ "build.gradle": "dependencies { api 'g:a:1' }\n", "gradle/libs.versions.toml": "[versions\nx = 1\n" });
    expect(dep(m, "a")?.version).toEqual({ resolved: true, value: "1", bestEffort: true });
    expect(m?.notices[0]).toContain("libs.versions.toml is not valid TOML");
  });

  it("reads every coordinate of a Groovy multi-coordinate declaration", async () => {
    const [m] = await files({ "build.gradle": "dependencies {\n  implementation 'g:a:1', 'g:b:2', {\n    transitive = false\n  }\n}\n" });
    expect(m?.dependencies.map((d) => `${d.artifact}:${d.version.resolved ? d.version.value : "?"}`)).toEqual(["a:1", "b:2"]);
  });

  it("reads a Groovy map-style declaration continued after a trailing comma", async () => {
    const [m] = await files({
      "build.gradle": "dependencies {\n  implementation group: 'com.google.guava', // core\n      name: 'guava', version: '33.0.0-jre'\n  testImplementation 'g:t:1'\n}\n",
    });
    expect(dep(m, "guava")).toEqual({
      group: "com.google.guava",
      artifact: "guava",
      version: { resolved: true, value: "33.0.0-jre", bestEffort: true },
      scope: "implementation",
    });
    expect(dep(m, "t")?.scope).toBe("testImplementation");
    expect(m?.notices).toEqual([]);
  });

  it("reads every coordinate of a Groovy multi-coordinate declaration continued after a trailing comma", async () => {
    const [m] = await files({ "build.gradle": "dependencies {\n  implementation 'g:a:1',\n\n    'g:b:2'\n  api 'g:c:3'\n}\n" });
    expect(m?.dependencies.map((d) => `${d.scope} ${d.artifact}`)).toEqual(["implementation a", "implementation b", "api c"]);
    expect(m?.notices).toEqual([]);
  });

  it("reads a catalog plugin alias declared with apply false, and a child inherits its version", async () => {
    const models = await files({
      "settings.gradle.kts": `include("app")\n`,
      "gradle/libs.versions.toml": `[plugins]\nboot = { id = "org.springframework.boot", version = "3.3.0" }\n`,
      "build.gradle.kts": "plugins {\n  alias(libs.plugins.boot) apply false\n}\n",
      "app/build.gradle.kts": `plugins {\n  id("org.springframework.boot")\n}\n`,
    });
    expect(module(models, ":")?.springBootVersion).toEqual({ resolved: true, value: "3.3.0" });
    expect(module(models, ":app")?.springBootVersion).toEqual({ resolved: true, value: "3.3.0" });
  });

  it("reads project dependencies, their test fixtures and target configurations", async () => {
    const [m] = await files({
      "build.gradle":
        "dependencies {\n" +
        "  implementation project(':lib')\n" +
        "  testImplementation(testFixtures(project(\":dao\")))\n" +
        "  testImplementation project(path: ':dao', configuration: 'testArtifacts')\n" +
        "  testImplementation(project(\":a:b\", \"tests\"))\n" +
        "  testImplementation files(project(':x').sourceSets.test.output)\n" +
        "  testImplementation project(':x').sourceSets.test.output\n" +
        "  implementation project(\"$name\")\n" +
        "}\n",
    });
    expect(m?.projects).toEqual([
      { path: ":lib", scope: "implementation" },
      { path: ":dao", scope: "testImplementation", testFixtures: true },
      { path: ":dao", scope: "testImplementation", configuration: "testArtifacts" },
      { path: ":a:b", scope: "testImplementation", configuration: "tests" },
    ]);
    expect(m?.dependencies).toEqual([]);
    expect(m?.notices).toEqual([expect.stringContaining(`project("$name")`)]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "treats an unreadable module build script as absent and reports it",
    async () => {
      dir = await mkdtemp(join(tmpdir(), "sv-gradle-build-"));
      await writeFile(join(dir, "settings.gradle"), "include 'x'\n");
      await mkdir(join(dir, "x"));
      await writeFile(join(dir, "x/build.gradle"), "dependencies { implementation 'g:a:1' }\n");
      await chmod(join(dir, "x/build.gradle"), 0o000);
      try {
        const layout = await discoverJavaModules(dir);
        const x = module(await readGradleBuildModels(dir, layout.modules), ":x");
        expect(x).toMatchObject({ dependencies: [], notices: ["x/build.gradle is unreadable (EACCES); skipped"] });
      } finally {
        await chmod(join(dir, "x/build.gradle"), 0o644);
      }
    },
  );

  it("returns an empty model for a module with no build script", async () => {
    const models = await files({ "settings.gradle": "include 'x'\n", "x/src/main/java/A.java": "class A {}\n" });
    expect(module(models, ":x")).toMatchObject({ dependencies: [], notices: [] });
  });
});

describe("GradleScript", () => {
  it("splits statements outside brackets and strings, joining dot-continuations", () => {
    const s = new GradleScript(`a 'x;y' // c; d\nb(1,\n 2)\nc\n  .d()\ne { f; g }`);
    expect(s.statements().map((x) => s.text(x))).toEqual([`a 'x;y'`, "b(1,\n 2)", "c\n  .d()", "e { f; g }"]);
  });

  it("joins a line ending in a comma or binary operator to the next, but not ++, -- or *", () => {
    const s = new GradleScript(`a 1,\n  2\nb = x +\n  y\nc = p &&\n  q\nd++\ne--\nimport f.*\ng & 1\nh`);
    expect(s.statements().map((x) => s.text(x))).toEqual([
      "a 1,\n  2",
      "b = x +\n  y",
      "c = p &&\n  q",
      "d++",
      "e--",
      "import f.*",
      "g & 1",
      "h",
    ]);
  });

  it("finds block bodies, with or without call arguments", () => {
    const s = new GradleScript(`plugins { id 'x' }\ntasks.withType(Foo) { y }\nbuildscript() { z }`);
    expect(s.blocks("plugins").map((b) => s.text(b))).toEqual(["id 'x'"]);
    expect(s.blocks("buildscript").map((b) => s.text(b))).toEqual(["z"]);
    expect(s.blocks("tasks")).toEqual([]);
  });
});

describe("parseToml", () => {
  it("reads tables, dotted keys, inline tables, multi-line arrays and comments", () => {
    expect(
      parseToml(`# c\n[a]\nx.y = "1" # tail\n'q-r' = { m = "g:a", v.ref = "z" }\nb = [\n "p", # one\n "q",\n]\nn = 3\nt = true\n`),
    ).toEqual({ a: { x: { y: "1" }, "q-r": { m: "g:a", v: { ref: "z" } }, b: ["p", "q"], n: 3, t: true } });
  });

  it("keeps __proto__ and constructor keys as own data, never touching a prototype", () => {
    const doc = parseToml(`[__proto__]\npolluted = "yes"\n[a]\nconstructor = "c"\n__proto__ = { x = "1" }\n`);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(doc.a)).toBe(Object.prototype);
    expect(Object.keys(doc)).toEqual(["__proto__", "a"]);
    expect(doc.a).toMatchObject({ constructor: "c" });
    expect(Object.getOwnPropertyDescriptor(doc.a, "__proto__")?.value).toEqual({ x: "1" });
  });

  it.each(["[a\nx=1", "x = ", "x = 'open", "x = 1 2", "a = 1\n[[a]]", 'x = """open',"x = 1\nx = 2", "x = bare"])("rejects %s", (src) => {
    expect(() => parseToml(src)).toThrow(TomlSyntaxError);
  });
});
