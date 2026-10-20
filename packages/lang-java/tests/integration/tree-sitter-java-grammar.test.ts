/**
 * The Java grammar this pack builds (its `build:grammars` script) loads in
 * Node through the runtime and parses Java. The grammar is a local build
 * artifact, so the test skips (with the command to run) when it has not been
 * built, unless SV_REQUIRE_GRAMMARS=1, which CI sets and which makes a
 * missing grammar fail.
 */

import { afterAll, describe, expect, it } from "vitest";
import { createTreeSitterRunner, skipUnlessGrammar, type Capture } from "@n-dx/lang-runtime";

import { javaGrammarPath, javaPack } from "../../src/java-pack.js";

const JAVA_WASM = javaGrammarPath();
const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

const SOURCE = `package com.example.orders;

import java.util.List;

@Service
public class OrderService {
  private final OrderRepository repository;

  public OrderService(OrderRepository repository) {
    this.repository = repository;
  }

  public List<Order> open() {
    return repository.findByStatus(Status.OPEN);
  }
}
`;

const texts = (captures: readonly Capture[] | undefined, name: string): string[] =>
  (captures ?? []).filter((c) => c.name === name).map((c) => c.text);

describe("tree-sitter-java grammar (WASM)", () => {
  it("parses a Java class without ERROR nodes", async (ctx) => {
    skipUnlessGrammar(ctx, JAVA_WASM);

    const result = await runner.parseSource({ pack: javaPack, grammarPath: JAVA_WASM }, "OrderService.java", SOURCE);

    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") return;
    expect(result.hasErrorNodes).toBe(false);
    expect(result.hasMissingNodes).toBe(false);
    expect(texts(result.captures.packages, "package.name")).toEqual(["com.example.orders"]);
    expect(texts(result.captures.imports, "import.name")).toEqual(["java.util.List"]);
    expect(texts(result.captures.declarations, "type.name")).toEqual(["OrderService"]);
  });
});
