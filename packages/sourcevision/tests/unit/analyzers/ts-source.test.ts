import { describe, it, expect } from "vitest";
import ts from "typescript";

import { parseJsTsSource } from "../../../src/analyzers/ts-source.js";

/** The kind the compiler recorded on the parsed file. */
function scriptKindOf(sf: ts.SourceFile): ts.ScriptKind {
  return (sf as ts.SourceFile & { scriptKind: ts.ScriptKind }).scriptKind;
}

describe("parseJsTsSource", () => {
  it.each([
    ["src/App.tsx", ts.ScriptKind.TSX],
    ["src/App.jsx", ts.ScriptKind.TSX],
    ["src/util.ts", ts.ScriptKind.TS],
    ["src/util.js", ts.ScriptKind.JS],
    ["src/util.mjs", ts.ScriptKind.JS],
    ["src/util.cjs", ts.ScriptKind.JS],
    ["src/util.mts", ts.ScriptKind.JS],
    // The extension match is case-sensitive.
    ["src/App.TSX", ts.ScriptKind.JS],
  ])("parses %s as script kind %i", (path, kind) => {
    expect(scriptKindOf(parseJsTsSource(path, "export const x = 1;\n"))).toBe(kind);
  });

  it("parses JSX in a .jsx file", () => {
    const sf = parseJsTsSource("src/App.jsx", "export const App = () => <div />;\n");
    expect(sf.languageVariant).toBe(ts.LanguageVariant.JSX);
  });

  it("keeps the file name and text", () => {
    const sf = parseJsTsSource("src/util.ts", "export const x = 1;\n");
    expect(sf.fileName).toBe("src/util.ts");
    expect(sf.text).toBe("export const x = 1;\n");
  });

  it("sets parent nodes unless asked not to", () => {
    const withParents = parseJsTsSource("src/util.ts", "export const x = 1;\n");
    expect(withParents.statements[0].parent).toBe(withParents);

    const withoutParents = parseJsTsSource("src/util.ts", "export const x = 1;\n", false);
    expect(withoutParents.statements[0].parent).toBeUndefined();
  });
});
