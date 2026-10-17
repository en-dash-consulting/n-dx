/**
 * Java resolver on a generated-file-sized capture set (fully qualified names
 * everywhere, as protobuf output writes them): outermost-span detection and
 * name filtering must stay near-linear, and classification must not change.
 */

import { describe, expect, it } from "vitest";

import { javaResolver } from "../../../src/language/java-resolver.js";
import type { Capture, PackSourceFile } from "../../../src/language/pack.js";

const QUALIFIED = 20_000;
const NAMES_PER_SPAN = 3;

const capture = (name: string, text: string, line: number, startCol: number, endCol: number): Capture => ({
  name,
  nodeType: "type_identifier",
  text,
  start: { line, column: startCol },
  end: { line, column: endCol },
});

const declares = (path: string, type: string): PackSourceFile => ({
  path,
  captures: {
    packages: [capture("package.name", "com.example", 0, 8, 19)],
    declarations: [capture("type.class", `class ${type} {}`, 2, 0, 20), capture("type.name", type, 2, 6, 6 + type.length)],
  },
});

describe("java resolver on a large generated file", () => {
  it("classifies names inside and outside qualified spans as before", () => {
    const refs: Capture[] = [];
    for (let i = 0; i < QUALIFIED; i++) {
      const line = 10 + i * 2;
      // `com.example.Inner.Hidden` nests `com.example.Inner`; names inside either are covered by the outer span.
      refs.push(capture("typeref.qualified", "com.example.Inner.Hidden", line, 0, 40));
      refs.push(capture("typeref.qualified", "com.example.Inner", line, 0, 25));
      for (let n = 0; n < NAMES_PER_SPAN; n++) refs.push(capture("typeref.name", "Hidden", line, 5 + n, 6 + n));
      // Outside every span.
      refs.push(capture("typeref.name", "Bare", line + 1, 0, 4));
    }
    const generated: PackSourceFile = {
      path: "gen/Generated.java",
      captures: { packages: [capture("package.name", "com.example", 0, 8, 19)], "type-references": refs },
    };

    const prepared = javaResolver.prepare([
      generated,
      declares("src/Bare.java", "Bare"),
      declares("src/Hidden.java", "Hidden"),
      declares("src/Inner.java", "Inner"),
    ]);
    const out = prepared.resolve("gen/Generated.java");

    // `Hidden` is only seen as a segment of the qualified name or inside it, never as a bare reference.
    expect(out.files.map((f) => f.to)).toEqual(["src/Bare.java", "src/Inner.java"]);
    expect(out.external).toEqual([]);
  });
});
