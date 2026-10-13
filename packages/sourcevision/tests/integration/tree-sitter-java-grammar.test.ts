/**
 * The Java grammar `@n-dx/lang-java` builds (its `build:grammars` script)
 * loads in Node through web-tree-sitter and parses Java. The grammar is a
 * local build artifact, so the test skips (with the command to run) when it
 * has not been built, unless SV_REQUIRE_GRAMMARS=1, which CI sets and which
 * makes a missing grammar fail.
 */

import { describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";

import { javaGrammarPath } from "@n-dx/lang-java";
import { skipUnlessGrammar } from "@n-dx/lang-runtime";

const JAVA_WASM = javaGrammarPath();

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

describe("tree-sitter-java grammar (WASM)", () => {
  it("parses a Java class without ERROR nodes", async (ctx) => {
    skipUnlessGrammar(ctx, JAVA_WASM);

    await Parser.init();
    const parser = new Parser();
    parser.setLanguage(await Language.load(JAVA_WASM));
    const tree = parser.parse(SOURCE);

    expect(tree).not.toBeNull();
    const root = tree!.rootNode;
    expect(root.type).toBe("program");
    expect(root.hasError).toBe(false);

    const types = root.namedChildren.map((node) => node?.type);
    expect(types).toEqual(["package_declaration", "import_declaration", "class_declaration"]);
    const cls = root.namedChildren[2]!;
    expect(cls.childForFieldName("name")?.text).toBe("OrderService");

    tree!.delete();
    parser.delete();
  });
});
