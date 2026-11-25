import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONFIG_SOURCES,
  DECLARED_FACT_KINDS,
  DYNAMIC_CODE_KINDS,
  FACT_KINDS,
  FLAG_MECHANISMS,
  IMPORT_FORMS,
  IMPORT_GUARDS,
  LEGACY_STATUSES,
  PRODUCED_FACT_KINDS,
  SYMBOL_KINDS,
  compareLanguageVersions,
  isFactKind,
  normalizeFlagName,
  type FlagCheckFact,
  type OutboundCallFact,
} from "../../src/index.js";

describe("pack contract", () => {
  it("names imports, symbols, calls, resources, routes, outbound calls, entry points, config reads, flag checks, the version floor, legacy constructs, dynamic code and declarations as produced", () => {
    expect([...PRODUCED_FACT_KINDS]).toEqual([
      "imports", "symbols", "calls", "resources", "routes", "outboundCalls", "entryPoints", "configReads", "flagChecks", "versionFloor",
      "legacyConstructs", "dynamicCode", "declarations",
    ]);
  });

  it("names dynamic code kinds", () => {
    expect([...DYNAMIC_CODE_KINDS]).toEqual(["exec", "dispatch", "include"]);
  });

  it("names legacy construct statuses, a removal first", () => {
    expect([...LEGACY_STATUSES]).toEqual(["removed", "deprecated", "notice"]);
  });

  it("compares language versions numerically, major then minor", () => {
    expect(compareLanguageVersions("5.3", "7.0")).toBeLessThan(0);
    expect(compareLanguageVersions("7.10", "7.4")).toBeGreaterThan(0);
    expect(compareLanguageVersions("8.1", "8.1")).toBe(0);
    expect(compareLanguageVersions("8", "8.0")).toBe(0);
  });

  it("names config sources and flag mechanisms", () => {
    expect([...CONFIG_SOURCES]).toEqual(["file", "env", "ini", "yaml", "xml", "json", "define", "unknown"]);
    expect([...FLAG_MECHANISMS]).toEqual(["constant", "config", "function", "sdk", "env"]);
  });

  it("records a flag check's gated lines, optionally", () => {
    const check: FlagCheckFact = {
      name: "FEATURE_NEW_CHECKOUT",
      normalized: normalizeFlagName("FEATURE_NEW_CHECKOUT"),
      mechanism: "constant",
      position: { line: 3, column: 4 },
      gated: { start: 4, end: 9 },
    };
    expect(check.normalized).toBe("new_checkout");
  });

  it("normalizes one flag's spellings to one name", () => {
    for (const name of ["FEATURE_NEW_CHECKOUT", "features.new_checkout", "ff-new-checkout", "FF_NEW_CHECKOUT", "Feature.New-Checkout", "new_checkout", "features:new checkout"]) {
      expect(normalizeFlagName(name), name).toBe("new_checkout");
    }
  });

  it("keeps a name that is only a prefix, and strips one prefix only", () => {
    expect(normalizeFlagName("feature")).toBe("feature");
    expect(normalizeFlagName("FEATURE_")).toBe("feature");
    expect(normalizeFlagName("FF_FEATURE_X")).toBe("feature_x");
    expect(normalizeFlagName("__beta__")).toBe("beta");
    expect(normalizeFlagName("featured_items")).toBe("featured_items");
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

  it("keeps SQL tables, Go structs and Python module-level names as their own symbol kinds", () => {
    expect(SYMBOL_KINDS).toContain("table");
    expect(SYMBOL_KINDS).toContain("struct");
    expect(SYMBOL_KINDS).toContain("variable");
    expect(new Set(SYMBOL_KINDS).size).toBe(SYMBOL_KINDS.length);
  });

  it("keeps PHP traits, namespaces and constants as their own symbol kinds", () => {
    for (const kind of ["trait", "namespace", "constant"]) expect(SYMBOL_KINDS).toContain(kind);
    expect(new Set(SYMBOL_KINDS).size).toBe(SYMBOL_KINDS.length);
  });

  it("guards an import that runs only under a condition", () => {
    expect([...IMPORT_GUARDS]).toEqual(["type-checking", "optional", "conditional"]);
  });

  it("names PHP's include forms and use imports as import forms", () => {
    expect([...IMPORT_FORMS]).toEqual(["include", "include_once", "require", "require_once", "use", "use function", "use const"]);
  });

  it("mentions no parser machinery", () => {
    const source = readFileSync(new URL("../../src/pack-contract.ts", import.meta.url), "utf-8");
    expect(source).not.toMatch(/tree-sitter|Capture\b|nodeType|GrammarLocator/i);
  });
});
