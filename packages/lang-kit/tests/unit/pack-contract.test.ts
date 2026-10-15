import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DECLARED_FACT_KINDS,
  FACT_KINDS,
  PRODUCED_FACT_KINDS,
  SYMBOL_KINDS,
  isFactKind,
  type OutboundCallFact,
} from "../../src/index.js";

describe("pack contract", () => {
  it("names imports, symbols, calls, resources, routes and outbound calls as produced", () => {
    expect([...PRODUCED_FACT_KINDS]).toEqual(["imports", "symbols", "calls", "resources", "routes", "outboundCalls"]);
  });

  it("names components as declared", () => {
    expect([...DECLARED_FACT_KINDS]).toEqual(["components"]);
  });

  it("grades an outbound call with sourcevision's confidence, optionally", () => {
    const graded: OutboundCallFact = {
      kind: "http",
      target: "orders.url",
      targetSource: "config",
      client: "RestTemplate",
      confidence: "likely",
      position: { line: 1, column: 0 },
    };
    const ungraded: OutboundCallFact = { ...graded, confidence: undefined };
    expect([graded.confidence, ungraded.confidence]).toEqual(["likely", undefined]);
  });

  it("lists every kind once, produced first", () => {
    expect(FACT_KINDS).toEqual([...PRODUCED_FACT_KINDS, ...DECLARED_FACT_KINDS]);
    expect(new Set(FACT_KINDS).size).toBe(FACT_KINDS.length);
  });

  it("recognises fact kinds by name", () => {
    expect(FACT_KINDS.every(isFactKind)).toBe(true);
    expect(isFactKind("path")).toBe(false);
    expect(isFactKind("outbound-calls")).toBe(false);
  });

  it("keeps SQL tables and Go structs as their own symbol kinds", () => {
    expect(SYMBOL_KINDS).toContain("table");
    expect(SYMBOL_KINDS).toContain("struct");
    expect(new Set(SYMBOL_KINDS).size).toBe(SYMBOL_KINDS.length);
  });

  it("mentions no parser machinery", () => {
    const source = readFileSync(new URL("../../src/pack-contract.ts", import.meta.url), "utf-8");
    expect(source).not.toMatch(/tree-sitter|Capture\b|nodeType|GrammarLocator/i);
  });
});
