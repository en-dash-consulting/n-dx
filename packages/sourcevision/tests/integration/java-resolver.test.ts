/**
 * The Java resolver over the pack fixture, asserted case by case so each
 * rule is pinned independently of the regenerable golden.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { grammarWasmPath } from "../../scripts/build-grammars.mjs";
import { javaPack } from "../../src/language/java-pack.js";
import type { FileReferences, PackSourceFile } from "../../src/language/pack.js";
import { createTreeSitterRunner } from "../../src/language/runner.js";
import { skipUnlessGrammar } from "../helpers/grammar.js";
import { fixtureDirFor, listFixtureFiles } from "../helpers/pack-golden.js";

const JAVA_WASM = grammarWasmPath("tree-sitter-java");
const FIXTURE = fixtureDirFor(javaPack);
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

  it("attributes references outside the project to their package", async (ctx) => {
    const resolve = await resolveFixture(ctx);
    expect(externals(resolve(`${APP}/Checkout.java`))).toEqual({
      "java.time": ["Instant"],
      "java.util": ["List"],
      "javax.inject": ["*"],
      "org.acme": ["Missing"],
    });
    expect(externals(resolve("src/com/example/shop/OrderService.java"))).toEqual({
      "java.io": ["Serializable"],
      "java.lang": ["*"],
      "java.util": ["HashMap", "List", "Map"],
      "java.util.function": ["*"],
      "java.util.stream": ["toList"],
      "org.springframework.beans.factory.annotation": ["Autowired"],
      "org.springframework.stereotype": ["Service"],
    });
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

  it("gives nothing for a file it was not prepared with", async (ctx) => {
    const resolve = await resolveFixture(ctx);
    expect(resolve("src/Missing.java")).toEqual({ files: [], external: [] });
  });
});
