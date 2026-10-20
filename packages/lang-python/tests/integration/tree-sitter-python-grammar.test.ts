/**
 * The Python grammar this pack builds (its `build:grammars` script) loads in
 * Node through the runtime and parses Python. The grammar is a local build
 * artifact, so the test skips (with the command to run) when it has not been
 * built, unless SV_REQUIRE_GRAMMARS=1, which CI sets and which makes a missing
 * grammar fail.
 */

import { afterAll, describe, expect, it } from "vitest";
import { createTreeSitterRunner, skipUnlessGrammar, type Capture } from "@n-dx/lang-runtime";

import { pythonGrammarPath, pythonPack } from "../../src/python-pack.js";

const PYTHON_WASM = pythonGrammarPath();
const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

const SOURCE = `from dataclasses import dataclass
import os.path


@dataclass
class Service:
    root: str

    async def open(self, name: str) -> str:
        match name:
            case "x":
                return os.path.join(self.root, name)
        return name
`;

const texts = (captures: readonly Capture[] | undefined, name: string): string[] =>
  (captures ?? []).filter((c) => c.name === name).map((c) => c.text);

describe("tree-sitter-python grammar (WASM)", () => {
  it("parses a Python file without ERROR nodes", async (ctx) => {
    skipUnlessGrammar(ctx, PYTHON_WASM);

    const result = await runner.parseSource({ pack: pythonPack, grammarPath: PYTHON_WASM }, "service.py", SOURCE);

    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") return;
    expect(result.hasErrorNodes).toBe(false);
    expect(result.hasMissingNodes).toBe(false);
    expect(texts(result.captures.imports, "import.from")).toEqual(["dataclasses"]);
    expect(texts(result.captures.imports, "import.module")).toEqual(["os.path"]);
    expect(texts(result.captures.definitions, "class.name")).toEqual(["Service"]);
    expect(texts(result.captures.definitions, "decorated.decorator")).toEqual(["dataclass"]);
  });
});
