/** The grammar build script's options: where grammars land and which are built. */

import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { GRAMMARS, grammarWasmPath, parseBuildArgs } from "../../scripts/build-grammars.mjs";

describe("build-grammars options", () => {
  it("builds into --out, resolved against the working directory", () => {
    expect(parseBuildArgs(["--out", "some/dir"]).outDir).toBe(resolve("some/dir"));
    expect(grammarWasmPath("tree-sitter-go", "/packs/go/build/grammars")).toBe(join("/packs/go/build/grammars", "tree-sitter-go.wasm"));
  });

  it("builds every grammar into --out when none is named", () => {
    expect(parseBuildArgs(["--out", "out"]).names).toEqual(Object.keys(GRAMMARS));
  });

  it("builds nothing without --out: each grammar belongs to one pack", () => {
    expect(() => parseBuildArgs([])).toThrow(/--out <dir> is required/);
    expect(() => parseBuildArgs(["tree-sitter-go"])).toThrow(/--out <dir> is required/);
  });

  it("builds only the grammars named", () => {
    expect(parseBuildArgs(["--out", "out", "tree-sitter-go", "tree-sitter-sql"]).names).toEqual(["tree-sitter-go", "tree-sitter-sql"]);
  });

  it("refuses an unknown grammar, naming the known ones", () => {
    expect(() => parseBuildArgs(["--out", "out", "tree-sitter-cobol"])).toThrow(/Unknown grammar tree-sitter-cobol; known: tree-sitter-java/);
  });
});
