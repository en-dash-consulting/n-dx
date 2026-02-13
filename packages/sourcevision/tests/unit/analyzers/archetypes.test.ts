import { describe, it, expect } from "vitest";
import { BUILTIN_ARCHETYPES, buildArchetypeMap } from "../../../src/analyzers/archetypes.js";
import type { ArchetypeDefinition } from "../../../src/schema/index.js";

describe("BUILTIN_ARCHETYPES", () => {
  it("contains 17 built-in archetypes", () => {
    expect(BUILTIN_ARCHETYPES).toHaveLength(17);
  });

  it("has unique IDs", () => {
    const ids = BUILTIN_ARCHETYPES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every archetype has required fields", () => {
    for (const a of BUILTIN_ARCHETYPES) {
      expect(typeof a.id).toBe("string");
      expect(a.id.length).toBeGreaterThan(0);
      expect(typeof a.name).toBe("string");
      expect(a.name.length).toBeGreaterThan(0);
      expect(typeof a.description).toBe("string");
      expect(a.description.length).toBeGreaterThan(0);
      expect(Array.isArray(a.signals)).toBe(true);
      expect(a.signals.length).toBeGreaterThan(0);
    }
  });

  it("all signal patterns are valid regex", () => {
    for (const a of BUILTIN_ARCHETYPES) {
      for (const sig of a.signals) {
        if (sig.kind !== "directory") {
          // Directory signals use string containment, not regex
          expect(() => new RegExp(sig.pattern)).not.toThrow();
        }
        expect(sig.weight).toBeGreaterThan(0);
        expect(sig.weight).toBeLessThanOrEqual(1.0);
      }
    }
  });

  it("all signal kinds are valid", () => {
    const validKinds = new Set(["path", "import", "export", "filename", "directory"]);
    for (const a of BUILTIN_ARCHETYPES) {
      for (const sig of a.signals) {
        expect(validKinds.has(sig.kind)).toBe(true);
      }
    }
  });

  it("includes expected archetype IDs", () => {
    const ids = new Set(BUILTIN_ARCHETYPES.map((a) => a.id));
    const expected = [
      "entrypoint", "utility", "types", "route-handler", "route-module",
      "component", "store", "middleware", "model", "gateway", "config",
      "hook", "service", "schema", "cli-command", "page", "test-helper",
    ];
    for (const id of expected) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("entrypoint archetype matches index.ts", () => {
    const entrypoint = BUILTIN_ARCHETYPES.find((a) => a.id === "entrypoint")!;
    const matches = entrypoint.signals.some(
      (s) => s.kind === "filename" && new RegExp(s.pattern).test("index.ts")
    );
    expect(matches).toBe(true);
  });

  it("utility archetype matches /utils/ directory", () => {
    const utility = BUILTIN_ARCHETYPES.find((a) => a.id === "utility")!;
    const matches = utility.signals.some(
      (s) => s.kind === "directory" && "src/utils/helpers.ts".includes(s.pattern)
    );
    expect(matches).toBe(true);
  });

  it("types archetype matches types.ts", () => {
    const types = BUILTIN_ARCHETYPES.find((a) => a.id === "types")!;
    const matches = types.signals.some(
      (s) => s.kind === "filename" && new RegExp(s.pattern).test("types.ts")
    );
    expect(matches).toBe(true);
  });
});

describe("buildArchetypeMap", () => {
  it("creates a map from archetype ID to definition", () => {
    const map = buildArchetypeMap(BUILTIN_ARCHETYPES);
    expect(map.size).toBe(BUILTIN_ARCHETYPES.length);
    expect(map.get("entrypoint")?.id).toBe("entrypoint");
    expect(map.get("utility")?.name).toBe("Utility");
  });

  it("works with empty array", () => {
    const map = buildArchetypeMap([]);
    expect(map.size).toBe(0);
  });

  it("works with custom archetypes", () => {
    const custom: ArchetypeDefinition[] = [
      {
        id: "worker",
        name: "Background Worker",
        description: "Background processing modules",
        signals: [{ kind: "directory", pattern: "/workers/", weight: 0.8 }],
      },
    ];
    const map = buildArchetypeMap(custom);
    expect(map.size).toBe(1);
    expect(map.get("worker")?.name).toBe("Background Worker");
  });
});
