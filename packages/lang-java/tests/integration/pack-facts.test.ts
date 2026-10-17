/**
 * The Java pack's captures read into lang-kit facts by its symbol rules, and
 * the pack entry run over a project: each fact says what the captures mean.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SourcePosition } from "@n-dx/lang-kit";

import {
  createPackEntry,
  createTreeSitterRunner,
  factGaps,
  readPackFacts,
  skipUnlessGrammar,
  type PackSourceFile,
  type ReadFactsOptions,
} from "@n-dx/lang-runtime";
import { JAVA_SYMBOL_RULES, javaGrammarPath, javaPack } from "../../src/java-pack.js";
import { JAVA_PACKAGE } from "../../src/package-paths.js";
import { pack } from "../../src/pack.js";

const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

type Ctx = Parameters<typeof skipUnlessGrammar>[0];

async function parse(ctx: Ctx, path: string, source: string): Promise<PackSourceFile> {
  skipUnlessGrammar(ctx, javaGrammarPath());
  const result = await runner.parseSource({ pack: javaPack, grammarPath: javaGrammarPath() }, path, source);
  if (result.status !== "parsed") throw new Error("expected a parsed file");
  expect(result.hasErrorNodes || result.hasMissingNodes).toBe(false);
  return { path, captures: result.captures };
}

const read = (file: PackSourceFile, options: Omit<ReadFactsOptions, "symbolRules"> = {}) =>
  readPackFacts(javaPack, file, { ...options, symbolRules: JAVA_SYMBOL_RULES });

/** One-based line and zero-based column where `needle` starts. */
function at(source: string, needle: string): SourcePosition {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`${needle} not in source`);
  const lines = source.slice(0, index).split("\n");
  return { line: lines.length, column: lines.at(-1)!.length };
}

const JAVA_CLINIC = `package com.example;

import java.util.List;
import com.example.model.Owner;

public class Clinic {
  private final JdbcTemplate jdbc;
  public Clinic(JdbcTemplate jdbc) { this.jdbc = jdbc; }
  List<Owner> owners() { return jdbc.query("SELECT * FROM owners", mapper()); }
  interface Visit { void at(); }
  enum Kind { CAT }
  record Pet(String name) {}
}
`;
const JAVA_OWNER = "package com.example.model;\n\npublic class Owner {}\n";

describe("Java facts", () => {
  it("declares types and callables with their enclosing type", async (ctx) => {
    const file = await parse(ctx, "src/com/example/Clinic.java", JAVA_CLINIC);
    const { symbols } = read(file, { kinds: ["symbols"] });
    expect(symbols?.map((s) => [s.kind, s.name, s.container])).toEqual([
      ["class", "Clinic", undefined],
      ["constructor", "Clinic", "Clinic"],
      ["method", "owners", "Clinic"],
      ["interface", "Visit", "Clinic"],
      ["method", "at", "Visit"],
      ["enum", "Kind", "Clinic"],
      ["record", "Pet", "Clinic"],
    ]);
    const clinic = symbols![0]!;
    expect(clinic.position).toEqual(at(JAVA_CLINIC, "Clinic {"));
    expect(clinic.span.start).toEqual(at(JAVA_CLINIC, "public class"));
    expect(symbols![2]!.position).toEqual(at(JAVA_CLINIC, "owners()"));
  });

  it("gives a method in an anonymous class no named container", async (ctx) => {
    const source =
      "class Clinic {\n  void start() { new Thread(new Runnable() { public void run() {} }); }\n  void stop() {}\n}\n";
    const file = await parse(ctx, "Clinic.java", source);
    const { symbols } = read(file, { kinds: ["symbols"] });
    expect(symbols?.map((s) => [s.name, s.container])).toEqual([
      ["Clinic", undefined],
      ["start", "Clinic"],
      ["run", undefined],
      ["stop", "Clinic"],
    ]);
  });

  it("groups calls with their receiver and own string arguments", async (ctx) => {
    const file = await parse(ctx, "src/com/example/Clinic.java", JAVA_CLINIC);
    const literal = '"SELECT * FROM owners"';
    const start = at(JAVA_CLINIC, literal);
    expect(read(file, { kinds: ["calls"] }).calls).toEqual([
      {
        callee: "query",
        receiver: "jdbc",
        strings: [{ text: literal, start, end: { line: start.line, column: start.column + literal.length } }],
      },
      { callee: "mapper", strings: [] },
    ]);
  });

  it("reads imports from the prepared resolver, unchanged", async (ctx) => {
    const clinic = await parse(ctx, "src/com/example/Clinic.java", JAVA_CLINIC);
    const owner = await parse(ctx, "src/com/example/model/Owner.java", JAVA_OWNER);
    const resolver = javaPack.resolver!.prepare([clinic, owner]);
    const facts = read(clinic, { resolver });
    expect(facts.imports).toEqual(resolver.resolve(clinic.path));
    expect(facts.imports?.files).toEqual([{ to: "src/com/example/model/Owner.java", symbols: ["Owner"] }]);
    expect(facts.imports?.external.map((e) => e.package)).toContain("java.util");
    expect(Object.keys(facts).sort()).toEqual(["calls", "imports", "path", "symbols"]);
  });

  it("leaves imports absent without a resolver", async (ctx) => {
    const file = await parse(ctx, "src/com/example/model/Owner.java", JAVA_OWNER);
    expect(read(file)).not.toHaveProperty("imports");
  });

  it("finds the pack's produces consistent with its resolver and rules", () => {
    expect(factGaps(javaPack, JAVA_SYMBOL_RULES)).toEqual([]);
  });
});

describe("Java pack entry", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function project(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "lang-java-entry-"));
    dirs.push(dir);
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(join(dir, dirname(path)), { recursive: true });
      writeFileSync(join(dir, path), source);
    }
    return dir;
  }

  it("returns the facts of every file it reads and lists the unreadable ones as unparsed", async (ctx) => {
    skipUnlessGrammar(ctx, javaGrammarPath());
    const projectDir = project({ "src/com/example/Clinic.java": JAVA_CLINIC, "src/com/example/model/Owner.java": JAVA_OWNER });
    const files = ["src/com/example/Clinic.java", "src/com/example/model/Owner.java", "src/Gone.java"];
    const result = await pack.analyzeProject({ projectDir, files });
    expect(result.degraded).toBeUndefined();
    expect(result.unparsed).toEqual(["src/Gone.java"]);
    expect(result.facts.map((f) => f.path)).toEqual(files.slice(0, 2));
    expect(result.facts[0]!.imports?.files).toEqual([{ to: "src/com/example/model/Owner.java", symbols: ["Owner"] }]);
    expect(result.facts[0]!.symbols?.[0]).toMatchObject({ kind: "class", name: "Clinic" });
  });

  it("reads only the kinds asked for", async (ctx) => {
    skipUnlessGrammar(ctx, javaGrammarPath());
    const projectDir = project({ "src/com/example/model/Owner.java": JAVA_OWNER });
    const result = await pack.analyzeProject({ projectDir, files: ["src/com/example/model/Owner.java"], kinds: ["imports"] });
    expect(Object.keys(result.facts[0]!).sort()).toEqual(["imports", "path"]);
  });

  it("degrades, naming the error and how to rebuild, when the grammar rejects a query", async (ctx) => {
    skipUnlessGrammar(ctx, javaGrammarPath());
    const projectDir = project({ "bad.scm": "(no_such_node_type) @x", "src/A.java": "class A {}\n" });
    const entry = createPackEntry({
      package: JAVA_PACKAGE,
      pack: { ...javaPack, queries: [{ name: "bad", path: join(projectDir, "bad.scm") }] },
      symbolRules: JAVA_SYMBOL_RULES,
    });
    const result = await entry.analyzeProject({ projectDir, files: ["src/A.java"] });
    expect(result.facts).toEqual([]);
    expect(result.degraded?.reason).toContain(`a query could not be compiled against grammar ${javaGrammarPath()}`);
    expect(result.degraded?.reason).toContain("no_such_node_type");
    expect(result.degraded?.remedy).toBe(JAVA_PACKAGE.rebuildStep());
  });
});
