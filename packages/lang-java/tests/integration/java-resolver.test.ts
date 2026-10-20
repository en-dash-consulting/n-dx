/**
 * The Java resolver over the pack fixture, asserted case by case so each
 * rule is pinned independently of the regenerable golden.
 */

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { javaGrammarPath, javaPack } from "../../src/java-pack.js";
import {
  createTreeSitterRunner,
  fixtureDirFor,
  listFixtureFiles,
  skipUnlessGrammar,
  type FileReferences,
  type PackSourceFile,
} from "@n-dx/lang-runtime";
import { PACK_FIXTURE_ROOT } from "../helpers/pack-fixtures.js";

const JAVA_WASM = javaGrammarPath();
const FIXTURE = fixtureDirFor(PACK_FIXTURE_ROOT, javaPack);
const APP = "src/com/example/app";

async function resolveFixture(ctx: Parameters<typeof skipUnlessGrammar>[0]): Promise<(path: string) => FileReferences> {
  skipUnlessGrammar(ctx, JAVA_WASM);
  const runner = createTreeSitterRunner();
  try {
    const files: PackSourceFile[] = [];
    for (const path of listFixtureFiles(FIXTURE, [".java"])) {
      const result = await runner.parseFile({ pack: javaPack, grammarPath: JAVA_WASM }, join(FIXTURE, path));
      if (result.status === "parsed") files.push({ path, captures: result.captures });
    }
    const prepared = javaPack.resolver!.prepare(files);
    return (path) => prepared.resolve(path);
  } finally {
    runner.dispose();
  }
}

const targets = (refs: FileReferences): Record<string, readonly string[]> =>
  Object.fromEntries(refs.files.map((f) => [f.to, f.symbols]));
const externals = (refs: FileReferences): Record<string, readonly string[]> =>
  Object.fromEntries(refs.external.map((e) => [e.package, e.symbols]));

describe("java resolver", () => {
  it("resolves every import form and bare name in Java's lookup order", async (ctx) => {
    const resolve = await resolveFixture(ctx);
    expect(targets(resolve(`${APP}/Checkout.java`))).toEqual({
      // Same package, no import: field type, enum used through Status.OPEN, call receiver.
      [`${APP}/Cart.java`]: ["Cart"],
      [`${APP}/Receipt.java`]: ["Receipt"],
      [`${APP}/Status.java`]: ["Status"],
      [`${APP}/Tax.java`]: ["Tax"],
      // Single-type import, nested-type import and a fully qualified use, all to the top-level file.
      "src/com/example/model/Customer.java": ["Address", "Customer"],
      // The single-type import shadows com.example.app.Clock.
      "src/com/example/time/Clock.java": ["Clock"],
      // Static member and static wildcard imports.
      "src/com/example/util/Constants.java": ["*"],
      "src/com/example/util/Numbers.java": ["round"],
      // Wildcard import: only the referenced type; Cart resolves in the same package first.
      "src/com/example/util/Strings.java": ["Strings"],
    });
  });

  it("attributes references outside the project to their package, under java: and JDK packages under java:stdlib:", async (ctx) => {
    const resolve = await resolveFixture(ctx);
    expect(externals(resolve(`${APP}/Checkout.java`))).toEqual({
      "java:stdlib:java.time": ["Instant"],
      "java:stdlib:java.util": ["List"],
      // javax.inject is a separate artifact, not the JDK.
      "java:javax.inject": ["*"],
      "java:org.acme": ["Missing"],
    });
    expect(externals(resolve("src/com/example/shop/OrderService.java"))).toEqual({
      "java:stdlib:java.io": ["Serializable"],
      "java:stdlib:java.lang": ["*"],
      "java:stdlib:java.util": ["HashMap", "List", "Map"],
      "java:stdlib:java.util.function": ["*"],
      "java:stdlib:java.util.stream": ["toList"],
      "java:org.springframework.beans.factory.annotation": ["Autowired"],
      "java:org.springframework.stereotype": ["Service"],
    });
  });

  it("puts the JDK's javax and jdk packages under java:stdlib: and the rest of javax under java:", async (ctx) => {
    skipUnlessGrammar(ctx, JAVA_WASM);
    const source = [
      "package a;",
      "import javax.sql.DataSource;",
      "import javax.xml.XMLConstants;",
      "import javax.xml.parsers.DocumentBuilder;",
      "import javax.xml.bind.JAXBContext;",
      "import javax.annotation.PostConstruct;",
      "import javax.annotation.processing.Processor;",
      "import jdk.jfr.Event;",
      "import javax.persistence.Entity;",
      "import javax.security.auth.Subject;",
      "import javax.security.auth.message.AuthStatus;",
      "import javax.management.MBeanServer;",
      "import javax.management.j2ee.Management;",
      "class Uses {}",
      "",
    ].join("\n");
    const runner = createTreeSitterRunner();
    try {
      const result = await runner.parseSource({ pack: javaPack, grammarPath: JAVA_WASM }, "src/a/Uses.java", source);
      if (result.status !== "parsed") throw new Error(`fixture did not parse: ${result.status}`);
      expect(externals(javaPack.resolver!.prepare([result]).resolve("src/a/Uses.java"))).toEqual({
        "java:stdlib:javax.sql": ["DataSource"],
        "java:stdlib:javax.xml": ["XMLConstants"],
        "java:stdlib:javax.xml.parsers": ["DocumentBuilder"],
        "java:stdlib:javax.annotation.processing": ["Processor"],
        "java:stdlib:jdk.jfr": ["Event"],
        "java:stdlib:javax.security.auth": ["Subject"],
        "java:stdlib:javax.management": ["MBeanServer"],
        // Removed from the JDK in 11, or never in it (Java EE, even under a JDK root).
        "java:javax.xml.bind": ["JAXBContext"],
        "java:javax.annotation": ["PostConstruct"],
        "java:javax.persistence": ["Entity"],
        "java:javax.security.auth.message": ["AuthStatus"],
        "java:javax.management.j2ee": ["Management"],
      });
    } finally {
      runner.dispose();
    }
  });

  it("resolves a wildcard import of a type's members across modules", async (ctx) => {
    skipUnlessGrammar(ctx, JAVA_WASM);
    const sources: Record<string, string> = {
      "core/src/main/java/a/Outer.java": "package a;\npublic class Outer { public static class In {} }\n",
      "app/src/main/java/b/User.java": "package b;\nimport a.Outer.*;\nclass User { In in; Peer peer; }\n",
      "app/src/main/java/b/Peer.java": "package b;\nclass Peer {}\n",
    };
    const runner = createTreeSitterRunner();
    try {
      const files: PackSourceFile[] = [];
      for (const [path, source] of Object.entries(sources)) {
        const result = await runner.parseSource({ pack: javaPack, grammarPath: JAVA_WASM }, path, source);
        if (result.status === "parsed") files.push(result);
      }
      const refs = javaPack.resolver!.prepare(files).resolve("app/src/main/java/b/User.java");
      expect(targets(refs)).toEqual({
        "app/src/main/java/b/Peer.java": ["Peer"],
        "core/src/main/java/a/Outer.java": ["In"],
      });
      expect(refs.external).toEqual([]);
    } finally {
      runner.dispose();
    }
  });

  describe("a name declared in several files", () => {
    const MAIN = "src/main/java/com/acme";
    const TEST = "src/test/java/com/acme";
    const sources: Record<string, string> = {
      // The same class in two services.
      "svc-a/src/main/java/com/acme/config/App.java": "package com.acme.config;\nclass App { SecurityConfig c; }\n",
      "svc-a/src/main/java/com/acme/config/SecurityConfig.java": "package com.acme.config;\nclass SecurityConfig {}\n",
      "svc-b/src/main/java/com/acme/config/SecurityConfig.java": "package com.acme.config;\nclass SecurityConfig {}\n",
      "svc-a/src/main/java/com/acme/web/Ctl.java":
        "package com.acme.web;\nimport com.acme.config.SecurityConfig;\nclass Ctl { SecurityConfig c; com.acme.config.SecurityConfig q; }\n",
      // A third service that declares neither: no way to choose.
      "svc-c/src/main/java/com/acme/web/Other.java":
        "package com.acme.web;\nimport com.acme.config.SecurityConfig;\nclass Other { SecurityConfig c; }\n",
      // A main class and a test class of the same name, and a test-only class.
      [`${MAIN}/Foo.java`]: "package com.acme;\nclass Foo { Helper h; TestOnly t; }\n",
      [`${MAIN}/Helper.java`]: "package com.acme;\nclass Helper {}\n",
      [`${TEST}/Helper.java`]: "package com.acme;\nclass Helper {}\n",
      [`${TEST}/TestOnly.java`]: "package com.acme;\nclass TestOnly {}\n",
      [`${TEST}/FooTest.java`]: "package com.acme;\nclass FooTest { Foo f; Helper h; TestOnly t; }\n",
      // A real tie: the same class twice in one source set.
      "gen/src/main/java/com/acme/Twin.java": "package com.acme;\nclass Twin {}\n",
      "gen/src/main/java/com/acme/copy/Twin.java": "package com.acme;\nclass Twin {}\n",
      "gen/src/main/java/com/acme/User.java": "package com.acme;\nclass User { Twin t; }\n",
      // A test naming classes declared only in other modules: one in a test set alone, one in a test set and a main set.
      "svc-a/src/test/java/com/acme/svc/SvcTest.java": "package com.acme.svc;\nclass SvcTest { TestUtils u; Widget w; }\n",
      "svc-b/src/test/java/com/acme/svc/TestUtils.java": "package com.acme.svc;\nclass TestUtils {}\n",
      "svc-b/src/test/java/com/acme/svc/Widget.java": "package com.acme.svc;\nclass Widget {}\n",
      "svc-c/src/main/java/com/acme/svc/Widget.java": "package com.acme.svc;\nclass Widget {}\n",
    };

    async function resolveSources(ctx: Parameters<typeof skipUnlessGrammar>[0]): Promise<(path: string) => FileReferences> {
      skipUnlessGrammar(ctx, JAVA_WASM);
      const runner = createTreeSitterRunner();
      try {
        const files: PackSourceFile[] = [];
        for (const [path, source] of Object.entries(sources)) {
          const result = await runner.parseSource({ pack: javaPack, grammarPath: JAVA_WASM }, path, source);
          if (result.status === "parsed") files.push(result);
        }
        const prepared = javaPack.resolver!.prepare(files);
        return (path) => prepared.resolve(path);
      } finally {
        runner.dispose();
      }
    }

    it("resolves to the declaration in the referencing file's own module", async (ctx) => {
      const resolve = await resolveSources(ctx);
      const own = { "svc-a/src/main/java/com/acme/config/SecurityConfig.java": ["SecurityConfig"] };
      expect(targets(resolve("svc-a/src/main/java/com/acme/config/App.java"))).toEqual(own);
      expect(targets(resolve("svc-a/src/main/java/com/acme/web/Ctl.java"))).toEqual(own);
    });

    it("never resolves main code to test code, and prefers a test's own source set", async (ctx) => {
      const resolve = await resolveSources(ctx);
      expect(targets(resolve(`${MAIN}/Foo.java`))).toEqual({ [`${MAIN}/Helper.java`]: ["Helper"] });
      expect(targets(resolve(`${TEST}/FooTest.java`))).toEqual({
        [`${MAIN}/Foo.java`]: ["Foo"],
        [`${TEST}/Helper.java`]: ["Helper"],
        [`${TEST}/TestOnly.java`]: ["TestOnly"],
      });
    });

    it("never resolves a test to another module's test code, but still to its main code", async (ctx) => {
      const resolve = await resolveSources(ctx);
      expect(targets(resolve("svc-a/src/test/java/com/acme/svc/SvcTest.java"))).toEqual({
        "svc-c/src/main/java/com/acme/svc/Widget.java": ["Widget"],
      });
    });

    it("fans out only on a real tie or when no candidate is in the file's own module", async (ctx) => {
      const resolve = await resolveSources(ctx);
      expect(targets(resolve("svc-c/src/main/java/com/acme/web/Other.java"))).toEqual({
        "svc-a/src/main/java/com/acme/config/SecurityConfig.java": ["SecurityConfig"],
        "svc-b/src/main/java/com/acme/config/SecurityConfig.java": ["SecurityConfig"],
      });
      expect(targets(resolve("gen/src/main/java/com/acme/User.java"))).toEqual({
        "gen/src/main/java/com/acme/Twin.java": ["Twin"],
        "gen/src/main/java/com/acme/copy/Twin.java": ["Twin"],
      });
    });
  });

  describe("another module's test code, through the build files", () => {
    const APP_TEST = "app/src/test/java/com/acme/app/AppTest.java";
    const APP_MAIN = "app/src/main/java/com/acme/app/App.java";
    const DAO_TEST = "dao/src/test/java/com/acme/dao/DaoTestBase.java";
    const DAO_FIXTURE = "dao/src/testFixtures/java/com/acme/dao/DaoFixture.java";
    const sources: Record<string, string> = {
      [APP_TEST]: "package com.acme.app;\nimport com.acme.dao.DaoTestBase;\nimport com.acme.dao.DaoFixture;\nclass AppTest { DaoTestBase b; DaoFixture f; }\n",
      [APP_MAIN]: "package com.acme.app;\nimport com.acme.dao.DaoTestBase;\nimport com.acme.dao.DaoFixture;\nclass App { DaoTestBase b; DaoFixture f; }\n",
      [DAO_TEST]: "package com.acme.dao;\nclass DaoTestBase {}\n",
      [DAO_FIXTURE]: "package com.acme.dao;\nclass DaoFixture {}\n",
    };
    const parent = "<parent><groupId>com.acme</groupId><artifactId>root</artifactId><version>1</version></parent>";
    const rootPom =
      "<project><groupId>com.acme</groupId><artifactId>root</artifactId><version>1</version>" +
      "<modules><module>app</module><module>dao</module></modules></project>";
    const daoPom = `<project>${parent}<artifactId>dao</artifactId></project>`;
    const appPom = (dependency: string): string =>
      `<project>${parent}<artifactId>app</artifactId><dependencies><dependency><groupId>com.acme</groupId><artifactId>dao</artifactId>${dependency}</dependency></dependencies></project>`;

    let dir: string | undefined;
    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
      dir = undefined;
    });

    async function resolveProject(
      ctx: Parameters<typeof skipUnlessGrammar>[0],
      buildFiles: Record<string, string>,
      unreadable: readonly string[] = [],
    ): Promise<(path: string) => FileReferences> {
      skipUnlessGrammar(ctx, JAVA_WASM);
      dir = await mkdtemp(join(tmpdir(), "lang-java-test-artifacts-"));
      for (const [rel, body] of Object.entries({ ...buildFiles, ...sources })) {
        await mkdir(dirname(join(dir, rel)), { recursive: true });
        await writeFile(join(dir, rel), body);
      }
      for (const rel of unreadable) await chmod(join(dir, rel), 0o000);
      const runner = createTreeSitterRunner();
      try {
        const files: PackSourceFile[] = [];
        for (const [path, source] of Object.entries(sources)) {
          const result = await runner.parseSource({ pack: javaPack, grammarPath: JAVA_WASM }, path, source);
          if (result.status === "parsed") files.push(result);
        }
        const bound = await javaPack.resolver!.forProject!(dir, Object.keys(sources));
        const prepared = bound.prepare(files);
        return (path) => prepared.resolve(path);
      } finally {
        runner.dispose();
      }
    }

    it("links a test to a Maven test-jar dependency's test classes, never main code", async (ctx) => {
      const resolve = await resolveProject(ctx, {
        "pom.xml": rootPom,
        "dao/pom.xml": daoPom,
        "app/pom.xml": appPom("<type>test-jar</type><scope>test</scope>"),
      });
      expect(targets(resolve(APP_TEST))).toEqual({ [DAO_TEST]: ["DaoTestBase"] });
      expect(targets(resolve(APP_MAIN))).toEqual({});
    });

    it("links a test to a Maven classifier-tests dependency's test classes", async (ctx) => {
      const resolve = await resolveProject(ctx, {
        "pom.xml": rootPom,
        "dao/pom.xml": daoPom,
        "app/pom.xml": appPom("<classifier>tests</classifier><scope>test</scope>"),
      });
      expect(targets(resolve(APP_TEST))).toEqual({ [DAO_TEST]: ["DaoTestBase"] });
    });

    it("links a test to a Gradle testFixtures dependency's fixtures, not its tests", async (ctx) => {
      const resolve = await resolveProject(ctx, {
        "settings.gradle": "include 'app', 'dao'\n",
        "dao/build.gradle": "plugins { id 'java-test-fixtures' }\n",
        "app/build.gradle": "dependencies {\n  testImplementation(testFixtures(project(':dao')))\n}\n",
      });
      expect(targets(resolve(APP_TEST))).toEqual({ [DAO_FIXTURE]: ["DaoFixture"] });
      expect(targets(resolve(APP_MAIN))).toEqual({});
    });

    it("links a test to a Gradle test-configuration dependency's test classes", async (ctx) => {
      const resolve = await resolveProject(ctx, {
        "settings.gradle.kts": `include("app", "dao")\n`,
        "app/build.gradle.kts": `dependencies {\n  testImplementation(project(path = ":dao", configuration = "testArtifacts"))\n}\n`,
      });
      expect(targets(resolve(APP_TEST))).toEqual({ [DAO_TEST]: ["DaoTestBase"] });
    });

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "still binds to the project when another module's Gradle build file is unreadable",
      async (ctx) => {
        const resolve = await resolveProject(ctx, {
          "settings.gradle": "include 'app', 'dao', 'locked'\n",
          "app/build.gradle": "dependencies {\n  testImplementation(testFixtures(project(':dao')))\n}\n",
          "locked/build.gradle": "dependencies {}\n",
          "locked/src/main/java/Locked.java": "class Locked {}\n",
        }, ["locked/build.gradle"]);
        expect(targets(resolve(APP_TEST))).toEqual({ [DAO_FIXTURE]: ["DaoFixture"] });
      },
    );

    it("still refuses the link without a test-artifact dependency", async (ctx) => {
      const maven = await resolveProject(ctx, {
        "pom.xml": rootPom,
        "dao/pom.xml": daoPom,
        "app/pom.xml": appPom("<scope>test</scope>"),
      });
      expect(targets(maven(APP_TEST))).toEqual({});
      await rm(dir!, { recursive: true, force: true });
      const gradle = await resolveProject(ctx, {
        "settings.gradle": "include 'app', 'dao'\n",
        "app/build.gradle": "dependencies {\n  testImplementation project(':dao')\n}\n",
      });
      expect(targets(gradle(APP_TEST))).toEqual({});
    });
  });

  it("never reports a project package as external, even for a type not in the repository", async (ctx) => {
    skipUnlessGrammar(ctx, JAVA_WASM);
    // Proto is generated at build time into a package the repository declares.
    const sources: Record<string, string> = {
      "src/a/Service.java":
        "package a;\nimport a.gen.Proto;\nimport static a.gen.Proto.parse;\nclass Service { a.gen.Other o; Proto p; }\n",
      "src/a/gen/Helper.java": "package a.gen;\nclass Helper {}\n",
    };
    const runner = createTreeSitterRunner();
    try {
      const files: PackSourceFile[] = [];
      for (const [path, source] of Object.entries(sources)) {
        const result = await runner.parseSource({ pack: javaPack, grammarPath: JAVA_WASM }, path, source);
        if (result.status === "parsed") files.push(result);
      }
      expect(javaPack.resolver!.prepare(files).resolve("src/a/Service.java")).toEqual({ files: [], external: [] });
    } finally {
      runner.dispose();
    }
  });

  it("gives nothing for a file it was not prepared with", async (ctx) => {
    const resolve = await resolveFixture(ctx);
    expect(resolve("src/Missing.java")).toEqual({ files: [], external: [] });
  });
});
