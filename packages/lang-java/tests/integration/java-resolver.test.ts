/**
 * The Java resolver over the pack fixture, asserted case by case so each
 * rule is pinned independently of the regenerable golden.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
        // Removed from the JDK in 11, or never in it.
        "java:javax.xml.bind": ["JAXBContext"],
        "java:javax.annotation": ["PostConstruct"],
        "java:javax.persistence": ["Entity"],
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
