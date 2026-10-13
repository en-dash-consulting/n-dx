/**
 * The Go grammar `@n-dx/lang-go` builds (its `build:grammars` script) loads in
 * Node through web-tree-sitter and parses Go. The grammar is a local build
 * artifact, so the test skips (with the command to run) when it has not been
 * built, unless SV_REQUIRE_GRAMMARS=1, which CI sets and which makes a
 * missing grammar fail.
 */

import { describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";

import { goGrammarPath } from "@n-dx/lang-go";
import { skipUnlessGrammar } from "@n-dx/lang-runtime";

const GO_WASM = goGrammarPath();

const SOURCE = `package orders

import (
	"fmt"
	"net/http"
)

type Service struct {
	repo Repository
}

func (s *Service) Open(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, s.repo.FindByStatus("open"))
}
`;

describe("tree-sitter-go grammar (WASM)", () => {
  it("parses a Go file without ERROR nodes", async (ctx) => {
    skipUnlessGrammar(ctx, GO_WASM);

    await Parser.init();
    const parser = new Parser();
    parser.setLanguage(await Language.load(GO_WASM));
    const tree = parser.parse(SOURCE);

    expect(tree).not.toBeNull();
    const root = tree!.rootNode;
    expect(root.type).toBe("source_file");
    expect(root.hasError).toBe(false);

    const types = root.namedChildren.map((node) => node?.type);
    expect(types).toEqual([
      "package_clause",
      "import_declaration",
      "type_declaration",
      "method_declaration",
    ]);
    expect(root.namedChildren[3]!.childForFieldName("name")?.text).toBe("Open");

    tree!.delete();
    parser.delete();
  });
});
