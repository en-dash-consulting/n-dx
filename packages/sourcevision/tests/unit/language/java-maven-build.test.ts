import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { ModuleBuildModel } from "../../../src/language/build-model.js";
import { readMavenBuildModels } from "../../../src/language/java-maven-build.js";
import { discoverJavaModules } from "../../../src/language/java-modules.js";
import { parseXml, XmlSyntaxError } from "../../../src/language/xml-lite.js";
import { UPDATE_ENV, updateRequested } from "../../helpers/pack-golden.js";

const FIXTURES = fileURLToPath(new URL("../../fixtures/maven-build", import.meta.url));

async function read(projectDir: string): Promise<ModuleBuildModel[]> {
  const layout = await discoverJavaModules(projectDir);
  return readMavenBuildModels(projectDir, layout.modules);
}

describe("Maven build model goldens", () => {
  for (const name of ["parent-child", "bom-import", "external-parent"]) {
    it(`matches the golden for ${name}`, async () => {
      const text = `${JSON.stringify(await read(join(FIXTURES, name)), null, 2)}\n`;
      const golden = join(FIXTURES, name, "golden.json");
      if (updateRequested()) writeFileSync(golden, text);
      else if (!existsSync(golden)) throw new Error(`No golden at ${golden}; create it with ${UPDATE_ENV}=1`);
      expect(text).toBe(readFileSync(golden, "utf-8"));
    });
  }
});

describe("Maven build model semantics", () => {
  const dep = (m: ModuleBuildModel | undefined, artifact: string) => m?.dependencies.find((d) => d.artifact === artifact);

  it("resolves through in-repository parents, with the child's property overriding", async () => {
    const child = (await read(join(FIXTURES, "parent-child"))).find((m) => m.module === "child");
    expect(dep(child, "junit-jupiter")).toMatchObject({ version: { resolved: true, value: "5.11.0" }, scope: "test" });
    expect(dep(child, "lib")?.version).toEqual({ resolved: true, value: "2.1.0" });
    expect(dep(child, "slf4j-api")?.version).toEqual({ resolved: true, value: "2.0.13" }); // inherited
    expect(child?.javaVersion).toEqual({ resolved: true, value: "21" }); // release beats the parent's java.version
    expect(child?.springBootVersion).toBeUndefined();
  });

  it("marks placeholders and versions it cannot resolve instead of guessing", async () => {
    const child = (await read(join(FIXTURES, "parent-child"))).find((m) => m.module === "child");
    expect(dep(child, "jackson-databind")?.version).toMatchObject({ resolved: false, reason: expect.stringContaining("jackson.missing") });
    expect(dep(child, "commons-lang3")?.version).toMatchObject({ resolved: false, reason: expect.stringContaining("none managed") });
  });

  it("applies in-repository BOMs and reports the Spring Boot BOM version", async () => {
    const app = (await read(join(FIXTURES, "bom-import"))).find((m) => m.module === "app");
    expect(dep(app, "guava")?.version).toEqual({ resolved: true, value: "33.2.1" });
    expect(dep(app, "spring-core")?.version).toMatchObject({
      resolved: false,
      reason: expect.stringContaining("org.springframework.boot:spring-boot-dependencies:3.2.5"),
    });
    expect(app?.springBootVersion).toEqual({ resolved: true, value: "3.2.5" });
    expect(app?.javaVersion).toEqual({ resolved: true, value: "11" });
  });

  it("marks versions managed by an external parent and reads the Spring Boot parent version", async () => {
    const [app] = await read(join(FIXTURES, "external-parent"));
    expect(app?.springBootVersion).toEqual({ resolved: true, value: "3.3.4" });
    expect(app?.javaVersion).toEqual({ resolved: true, value: "21" });
    expect(dep(app, "spring-boot-starter-web")?.version).toMatchObject({
      resolved: false,
      reason: expect.stringContaining("spring-boot-starter-parent:3.3.4"),
    });
    expect(dep(app, "spring-boot-starter-test")?.scope).toBe("test");
    expect(dep(app, "pinned")?.version).toMatchObject({ resolved: false, reason: expect.stringContaining("spring-retry.version") });
  });

  describe("on disk", () => {
    let dir: string | undefined;
    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
      dir = undefined;
    });

    async function pom(rel: string, body: string): Promise<void> {
      await mkdir(dirname(join(dir!, rel)), { recursive: true });
      await writeFile(join(dir!, rel), body);
    }
    const parent = "<parent><groupId>g</groupId><artifactId>root</artifactId><version>1</version></parent>";

    it("applies an in-repository BOM listed after the module that imports it, and its Spring Boot version", async () => {
      dir = await mkdtemp(join(tmpdir(), "sv-maven-build-"));
      await pom(
        "pom.xml",
        "<project><groupId>g</groupId><artifactId>root</artifactId><version>1</version><modules><module>app</module><module>bom</module></modules></project>",
      );
      await pom(
        "app/pom.xml",
        `<project>${parent}<artifactId>app</artifactId>
           <dependencyManagement><dependencies><dependency><groupId>g</groupId><artifactId>bom</artifactId><version>1</version><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement>
           <dependencies><dependency><groupId>x</groupId><artifactId>lib</artifactId></dependency></dependencies></project>`,
      );
      await pom(
        "bom/pom.xml",
        `<project>${parent}<artifactId>bom</artifactId>
           <dependencyManagement><dependencies>
             <dependency><groupId>x</groupId><artifactId>lib</artifactId><version>4.2</version></dependency>
             <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-dependencies</artifactId><version>3.1.0</version><type>pom</type><scope>import</scope></dependency>
           </dependencies></dependencyManagement></project>`,
      );
      const app = (await read(dir)).find((m) => m.module === "app");
      expect(dep(app, "lib")?.version).toEqual({ resolved: true, value: "4.2" });
      expect(app?.springBootVersion).toEqual({ resolved: true, value: "3.1.0" });
    });

    it("keeps dependencies that differ only by type or classifier, each with its own scope", async () => {
      dir = await mkdtemp(join(tmpdir(), "sv-maven-build-"));
      await pom(
        "pom.xml",
        `<project><groupId>g</groupId><artifactId>app</artifactId><version>1</version>
           <dependencies>
             <dependency><groupId>com.acme</groupId><artifactId>core</artifactId><version>1.0</version></dependency>
             <dependency><groupId>com.acme</groupId><artifactId>core</artifactId><version>1.0</version><classifier>tests</classifier><scope>test</scope></dependency>
             <dependency><groupId>com.acme</groupId><artifactId>util</artifactId><version>1.0</version><type>test-jar</type><scope>test</scope></dependency>
           </dependencies></project>`,
      );
      const [model] = await read(dir);
      expect(model?.dependencies.map((d) => [d.artifact, d.type, d.classifier, d.scope])).toEqual([
        ["core", undefined, undefined, "compile"],
        ["core", undefined, "tests", "test"],
        ["util", "test-jar", "tests", "test"],
      ]);
    });

    it("applies managed entries only to the dependency with the same type and classifier", async () => {
      dir = await mkdtemp(join(tmpdir(), "sv-maven-build-"));
      await pom(
        "pom.xml",
        `<project><groupId>g</groupId><artifactId>app</artifactId><version>1</version>
           <dependencyManagement><dependencies>
             <dependency><groupId>com.acme</groupId><artifactId>core</artifactId><version>1.0</version></dependency>
             <dependency><groupId>com.acme</groupId><artifactId>core</artifactId><version>2.0</version><type>test-jar</type><scope>test</scope></dependency>
           </dependencies></dependencyManagement>
           <dependencies>
             <dependency><groupId>com.acme</groupId><artifactId>core</artifactId></dependency>
             <dependency><groupId>com.acme</groupId><artifactId>core</artifactId><classifier>tests</classifier><type>test-jar</type></dependency>
             <dependency><groupId>com.acme</groupId><artifactId>core</artifactId><classifier>sources</classifier></dependency>
           </dependencies></project>`,
      );
      const [model] = await read(dir);
      const by = (classifier: string | undefined) => model?.dependencies.find((d) => d.classifier === classifier);
      expect(by(undefined)).toMatchObject({ version: { resolved: true, value: "1.0" }, scope: "compile" });
      expect(by("tests")).toMatchObject({ version: { resolved: true, value: "2.0" }, scope: "test" });
      expect(by("sources")?.version).toMatchObject({ resolved: false }); // no managed entry for this classifier
    });

    it("reports a malformed pom as a notice and keeps the module", async () => {
      dir = await mkdtemp(join(tmpdir(), "sv-maven-build-"));
      await mkdir(dirname(join(dir, "pom.xml")), { recursive: true });
      await writeFile(join(dir, "pom.xml"), "<project><artifactId>broken</project>");
      const [model] = await read(dir);
      expect(model?.dependencies).toEqual([]);
      expect(model?.notices[0]).toContain("not valid XML");
    });
  });
});

describe("parseXml", () => {
  it("reads nested elements, attributes, CDATA, entities, comments and declarations", () => {
    const root = parseXml(
      `<?xml version="1.0"?><!DOCTYPE p [<!ENTITY x "y">]><p a="1>2"><!-- c --><v>a &amp; b &#65;</v><w><![CDATA[<raw>]]></w><e/></p>`,
    );
    expect(root.children.map((c) => c.name)).toEqual(["v", "w", "e"]);
    expect(root.children[0]?.text).toBe("a & b A");
    expect(root.children[1]?.text).toBe("<raw>");
  });

  it.each(["<a><b></a>", "<a>", "<a></a><b/>", "<a>&nope;</a>", "text"])("rejects %s", (src) => {
    expect(() => parseXml(src)).toThrow(XmlSyntaxError);
  });
});
