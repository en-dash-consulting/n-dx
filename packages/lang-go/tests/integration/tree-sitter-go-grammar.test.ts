/**
 * The Go grammar this pack builds (its `build:grammars` script) loads in Node
 * through the runtime and parses Go. The grammar is a local build artifact,
 * so the test skips (with the command to run) when it has not been built,
 * unless SV_REQUIRE_GRAMMARS=1, which CI sets and which makes a missing
 * grammar fail.
 */

import { afterAll, describe, expect, it } from "vitest";
import { createTreeSitterRunner, skipUnlessGrammar, type Capture } from "@n-dx/lang-runtime";

import { goGrammarPath, goPack } from "../../src/go-pack.js";

const GO_WASM = goGrammarPath();
const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

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

const texts = (captures: readonly Capture[] | undefined, name: string): string[] =>
  (captures ?? []).filter((c) => c.name === name).map((c) => c.text);

describe("tree-sitter-go grammar (WASM)", () => {
  it("parses a Go file without ERROR nodes", async (ctx) => {
    skipUnlessGrammar(ctx, GO_WASM);

    const result = await runner.parseSource({ pack: goPack, grammarPath: GO_WASM }, "orders.go", SOURCE);

    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") return;
    expect(result.hasErrorNodes).toBe(false);
    expect(result.hasMissingNodes).toBe(false);
    expect(texts(result.captures.packages, "package.name")).toEqual(["orders"]);
    expect(texts(result.captures.imports, "import.name")).toEqual(["fmt", "net/http"]);
    expect(texts(result.captures.types, "type.name")).toEqual(["Service"]);
  });
});
