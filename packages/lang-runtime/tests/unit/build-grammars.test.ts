/** The grammar build script's options: where grammars land and which are built. */

import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { GRAMMAR_BUILD_DIR, GRAMMARS, grammarWasmPath, parseBuildArgs } from "../../scripts/build-grammars.mjs";

const SOURCEVISION_GRAMMARS = resolve(import.meta.dirname, "..", "..", "..", "sourcevision", "build", "grammars");

describe("build-grammars options", () => {
  it("builds every grammar into sourcevision's build/grammars when given no option", () => {
    expect(GRAMMAR_BUILD_DIR).toBe(SOURCEVISION_GRAMMARS);
    expect(parseBuildArgs([])).toEqual({ outDir: SOURCEVISION_GRAMMARS, names: Object.keys(GRAMMARS) });
    expect(grammarWasmPath("tree-sitter-go")).toBe(join(SOURCEVISION_GRAMMARS, "tree-sitter-go.wasm"));
  });

  it("builds into --out, resolved against the working directory", () => {
    expect(parseBuildArgs(["--out", "some/dir"]).outDir).toBe(resolve("some/dir"));
    expect(grammarWasmPath("tree-sitter-go", "/packs/go/build/grammars")).toBe(join("/packs/go/build/grammars", "tree-sitter-go.wasm"));
  });

  it("builds only the grammars named", () => {
    expect(parseBuildArgs(["tree-sitter-go", "tree-sitter-sql"]).names).toEqual(["tree-sitter-go", "tree-sitter-sql"]);
  });

  it("refuses an unknown grammar, naming the known ones", () => {
    expect(() => parseBuildArgs(["tree-sitter-cobol"])).toThrow(/Unknown grammar tree-sitter-cobol; known: tree-sitter-java/);
  });
});
