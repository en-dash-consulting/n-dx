/**
 * Archetype classification tests for Go projects.
 *
 * Validates that Go-specific archetype signals fire correctly on Go fixture
 * files, that React/JS-only archetypes do NOT fire on Go projects (false-positive
 * guard), and that JS/TS archetypes still match correctly (regression guard).
 */

import { describe, it, expect } from "vitest";
import { analyzeClassifications } from "../../../src/analyzers/classify.js";
import { BUILTIN_ARCHETYPES } from "../../../src/analyzers/archetypes.js";
import type { Inventory, Imports, FileEntry, FileClassification } from "../../../src/schema/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Inventory from file paths, all treated as source files. */
function makeInventory(paths: string[]): Inventory {
  const files: FileEntry[] = paths.map((p) => ({
    path: p,
    size: 100,
    language: p.endsWith(".go") ? "go" : "typescript",
    lineCount: 50,
    hash: "abc123",
    role: "source" as const,
    category: "general",
  }));
  return {
    files,
    summary: {
      totalFiles: files.length,
      totalLines: files.length * 50,
      byLanguage: {},
      byRole: { source: files.length },
      byCategory: {},
    },
  };
}

/** Empty imports — no edges needed for path/filename/directory signals. */
const EMPTY_IMPORTS: Imports = {
  edges: [],
  external: [],
  summary: {
    totalEdges: 0,
    totalExternal: 0,
    circularCount: 0,
    circulars: [],
    mostImported: [],
    avgImportsPerFile: 0,
  },
};

/** Classify a single file path and return its FileClassification. */
function classifySingle(
  filePath: string,
  projectLanguage: string,
): FileClassification {
  const inventory = makeInventory([filePath]);
  const result = analyzeClassifications(inventory, EMPTY_IMPORTS, { projectLanguage });
  const fc = result.files.find((f) => f.path === filePath);
  if (!fc) throw new Error(`File ${filePath} not found in classification results`);
  return fc;
}

/** Classify multiple file paths and return a map from path to classification. */
function classifyAll(
  filePaths: string[],
  projectLanguage: string,
): Map<string, FileClassification> {
  const inventory = makeInventory(filePaths);
  const result = analyzeClassifications(inventory, EMPTY_IMPORTS, { projectLanguage });
  return new Map(result.files.map((f) => [f.path, f]));
}

/** React-only archetype IDs that must never fire on Go projects. */
const REACT_ONLY_ARCHETYPES = ["route-module", "component", "hook", "page"];

// ── Go fixture file paths (mirror tests/fixtures/go-project/) ────────────────

const GO_FIXTURES = {
  entrypoint: "cmd/api/main.go",
  router: "cmd/api/router.go",
  setup: "cmd/api/setup.go",
  config: "internal/config/config.go",
  handler: "internal/handler/user.go",
  handlerTest: "internal/handler/user_test.go",
  middlewareAuth: "internal/middleware/auth.go",
  middlewareLogging: "internal/middleware/logging.go",
  repositoryDb: "internal/repository/db.go",
  repositoryDrivers: "internal/repository/drivers.go",
  repositoryUser: "internal/repository/user.go",
  repositoryUserTest: "internal/repository/user_test.go",
  service: "internal/service/user.go",
  serviceTest: "internal/service/user_test.go",
  pkgResponse: "pkg/response/json.go",
  pkgResponseTest: "pkg/response/json_test.go",
  testdata: "testdata/users.json",
};

// ── Go archetype matching ────────────────────────────────────────────────────

describe("Go archetype classification", () => {
  describe("entrypoint archetype", () => {
    it("cmd/api/main.go matches entrypoint via main.go filename", () => {
      const fc = classifySingle(GO_FIXTURES.entrypoint, "go");
      expect(fc.archetype).toBe("entrypoint");
      expect(fc.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("entrypoint evidence includes main.go filename signal", () => {
      const fc = classifySingle(GO_FIXTURES.entrypoint, "go");
      const mainGoEvidence = fc.evidence?.find(
        (e) => e.archetypeId === "entrypoint" && e.detail.includes("main.go"),
      );
      expect(mainGoEvidence).toBeDefined();
    });

    it("/cmd/ directory signal fires when path has a parent prefix", () => {
      // Relative paths starting with cmd/ don't contain "/cmd/", but nested
      // paths like "myapp/cmd/api/main.go" do.
      const fc = classifySingle("myapp/cmd/api/main.go", "go");
      const cmdEvidence = fc.evidence?.find(
        (e) => e.archetypeId === "entrypoint" && e.detail.includes("/cmd/"),
      );
      expect(cmdEvidence).toBeDefined();
    });

    it("combined main.go + /cmd/ directory signals yield confidence 1.0", () => {
      // main.go (0.9) + /cmd/ (0.7) = 1.6, capped at 1.0
      const fc = classifySingle("myapp/cmd/api/main.go", "go");
      expect(fc.confidence).toBe(1);
    });

    it("root-relative cmd/api/main.go still matches via main.go filename alone", () => {
      // When the path starts with cmd/ (no leading component), the /cmd/
      // directory signal does not fire, but the filename signal (0.9) suffices.
      const fc = classifySingle(GO_FIXTURES.entrypoint, "go");
      expect(fc.confidence).toBe(0.9);
    });
  });

  describe("route-handler archetype", () => {
    it("internal/handler/user.go matches route-handler via /handler/ directory", () => {
      const fc = classifySingle(GO_FIXTURES.handler, "go");
      expect(fc.archetype).toBe("route-handler");
      expect(fc.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("route-handler evidence includes /handler/ directory signal", () => {
      const fc = classifySingle(GO_FIXTURES.handler, "go");
      const handlerEvidence = fc.evidence?.find(
        (e) => e.archetypeId === "route-handler" && e.detail.includes("/handler/"),
      );
      expect(handlerEvidence).toBeDefined();
    });
  });

  describe("config archetype", () => {
    it("internal/config/config.go matches config archetype", () => {
      const fc = classifySingle(GO_FIXTURES.config, "go");
      expect(fc.archetype).toBe("config");
      expect(fc.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("config evidence includes both config.go filename and /config/ directory signals", () => {
      const fc = classifySingle(GO_FIXTURES.config, "go");
      const filenameEvidence = fc.evidence?.find(
        (e) => e.archetypeId === "config" && e.detail.includes("config.go"),
      );
      const directoryEvidence = fc.evidence?.find(
        (e) => e.archetypeId === "config" && e.detail.includes("/config/"),
      );
      expect(filenameEvidence).toBeDefined();
      expect(directoryEvidence).toBeDefined();
    });
  });

  describe("test-helper archetype", () => {
    it("nested testdata/ path matches test-helper via /testdata/ directory", () => {
      // The /testdata/ directory signal requires the path to contain "/testdata/"
      // (not start with "testdata/"). Nested paths like internal/testdata/ match.
      const fc = classifySingle("internal/testdata/users.json", "go");
      expect(fc.archetype).toBe("test-helper");
      expect(fc.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("test-helper evidence includes /testdata/ directory signal", () => {
      const fc = classifySingle("internal/testdata/users.json", "go");
      const testdataEvidence = fc.evidence?.find(
        (e) => e.archetypeId === "test-helper" && e.detail.includes("/testdata/"),
      );
      expect(testdataEvidence).toBeDefined();
    });

    it("root-level testdata/ path does not match (no embedded /testdata/ segment)", () => {
      // "testdata/users.json" starts with testdata/ but doesn't contain "/testdata/"
      // so the directory signal does not fire.
      const fc = classifySingle(GO_FIXTURES.testdata, "go");
      expect(fc.archetype).toBeNull();
    });
  });

  describe("service archetype", () => {
    it("internal/service/user.go matches service via /service/ directory", () => {
      const fc = classifySingle(GO_FIXTURES.service, "go");
      expect(fc.archetype).toBe("service");
      expect(fc.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("service evidence includes /service/ directory signal", () => {
      const fc = classifySingle(GO_FIXTURES.service, "go");
      const serviceEvidence = fc.evidence?.find(
        (e) => e.archetypeId === "service" && e.detail.includes("/service/"),
      );
      expect(serviceEvidence).toBeDefined();
    });
  });

  describe("middleware archetype", () => {
    it("internal/middleware/auth.go matches middleware via /middleware/ directory", () => {
      const fc = classifySingle(GO_FIXTURES.middlewareAuth, "go");
      expect(fc.archetype).toBe("middleware");
      expect(fc.confidence).toBeGreaterThanOrEqual(0.4);
    });
  });

  describe("additional Go fixtures", () => {
    it("cmd/api/router.go matches route-handler via /api/ directory signal", () => {
      // router.go in cmd/api/ matches the route-handler /api/ directory signal (0.6).
      // The Go /cmd/ entrypoint signal doesn't fire because the path starts with
      // "cmd/" (no leading slash), so "/cmd/" is not found by includes().
      const fc = classifySingle(GO_FIXTURES.router, "go");
      expect(fc.archetype).toBe("route-handler");
    });
  });
});

// ── False-positive guard: React archetypes must NOT match Go files ────────────

describe("React archetype false-positive guard (Go project)", () => {
  const allGoFixturePaths = Object.values(GO_FIXTURES);

  it("route-module archetype does not match any Go fixture file", () => {
    const classifiedMap = classifyAll(allGoFixturePaths, "go");
    for (const [path, fc] of classifiedMap) {
      expect(fc.archetype, `${path} should not be classified as route-module`).not.toBe("route-module");
      expect(
        fc.secondaryArchetypes ?? [],
        `${path} should not have route-module as secondary`,
      ).not.toContain("route-module");
    }
  });

  it("component archetype does not match any Go fixture file", () => {
    const classifiedMap = classifyAll(allGoFixturePaths, "go");
    for (const [path, fc] of classifiedMap) {
      expect(fc.archetype, `${path} should not be classified as component`).not.toBe("component");
      expect(
        fc.secondaryArchetypes ?? [],
        `${path} should not have component as secondary`,
      ).not.toContain("component");
    }
  });

  it("hook archetype does not match any Go fixture file", () => {
    const classifiedMap = classifyAll(allGoFixturePaths, "go");
    for (const [path, fc] of classifiedMap) {
      expect(fc.archetype, `${path} should not be classified as hook`).not.toBe("hook");
      expect(
        fc.secondaryArchetypes ?? [],
        `${path} should not have hook as secondary`,
      ).not.toContain("hook");
    }
  });

  it("page archetype does not match any Go fixture file", () => {
    const classifiedMap = classifyAll(allGoFixturePaths, "go");
    for (const [path, fc] of classifiedMap) {
      expect(fc.archetype, `${path} should not be classified as page`).not.toBe("page");
      expect(
        fc.secondaryArchetypes ?? [],
        `${path} should not have page as secondary`,
      ).not.toContain("page");
    }
  });

  it("no Go fixture file has any React-only archetype as primary or secondary", () => {
    const classifiedMap = classifyAll(allGoFixturePaths, "go");
    for (const [path, fc] of classifiedMap) {
      for (const reactArchetype of REACT_ONLY_ARCHETYPES) {
        expect(
          fc.archetype,
          `${path} should not be classified as ${reactArchetype}`,
        ).not.toBe(reactArchetype);
        expect(
          fc.secondaryArchetypes ?? [],
          `${path} should not have ${reactArchetype} as secondary`,
        ).not.toContain(reactArchetype);
      }
    }
  });
});

// ── Language scoping: Go-only signals must NOT fire without Go language ───────

describe("Go-only signals respect language scoping", () => {
  it("main.go filename signal does not fire when projectLanguage is typescript", () => {
    const fc = classifySingle(GO_FIXTURES.entrypoint, "typescript");
    // The Go-specific main.go signal (weight 0.9) should be skipped.
    // The /cmd/ Go signal should also be skipped.
    // Only non-language-scoped signals can match.
    const goMainEvidence = fc.evidence?.find(
      (e) => e.detail.includes("main.go"),
    );
    expect(goMainEvidence).toBeUndefined();
  });

  it("/cmd/ Go directory signal does not fire when projectLanguage is typescript", () => {
    const fc = classifySingle(GO_FIXTURES.entrypoint, "typescript");
    // The Go-scoped /cmd/ entrypoint signal (weight 0.7) should NOT fire.
    // However, the cli-command /cmd/ signal (not language-scoped) can still fire.
    const goEntrypointCmd = fc.evidence?.find(
      (e) => e.archetypeId === "entrypoint" && e.detail.includes("/cmd/"),
    );
    expect(goEntrypointCmd).toBeUndefined();
  });

  it("/handler/ Go directory signal does not fire when projectLanguage is typescript", () => {
    const fc = classifySingle(GO_FIXTURES.handler, "typescript");
    // Go-scoped /handler/ signal should not fire
    const goHandlerEvidence = fc.evidence?.find(
      (e) => e.archetypeId === "route-handler" && e.detail.includes("/handler/"),
    );
    expect(goHandlerEvidence).toBeUndefined();
  });

  it("/testdata/ Go directory signal does not fire when projectLanguage is typescript", () => {
    const fc = classifySingle(GO_FIXTURES.testdata, "typescript");
    const goTestdataEvidence = fc.evidence?.find(
      (e) => e.archetypeId === "test-helper" && e.detail.includes("/testdata/"),
    );
    expect(goTestdataEvidence).toBeUndefined();
  });
});

// ── JS/TS regression guard ───────────────────────────────────────────────────

describe("JS/TS archetype regression guard", () => {
  it("index.ts matches entrypoint archetype in a TypeScript project", () => {
    const fc = classifySingle("src/index.ts", "typescript");
    expect(fc.archetype).toBe("entrypoint");
  });

  it("public.ts matches entrypoint archetype in a TypeScript project", () => {
    const fc = classifySingle("src/public.ts", "typescript");
    expect(fc.archetype).toBe("entrypoint");
  });

  it("types.ts matches types archetype in a TypeScript project", () => {
    const fc = classifySingle("src/types.ts", "typescript");
    expect(fc.archetype).toBe("types");
  });

  it("useAuth.ts matches hook archetype in a TypeScript project", () => {
    const fc = classifySingle("src/hooks/useAuth.ts", "typescript");
    expect(fc.archetype).toBe("hook");
  });

  it("Button.tsx matches component archetype in a TypeScript project", () => {
    const fc = classifySingle("src/components/Button.tsx", "typescript");
    expect(fc.archetype).toBe("component");
  });

  it("src/pages/Home.tsx matches page archetype in a TypeScript project", () => {
    const fc = classifySingle("src/pages/Home.tsx", "typescript");
    expect(fc.archetype).toBe("page");
  });

  it("route-handler signals for JS/TS still match", () => {
    const fc = classifySingle("src/routes/users.ts", "typescript");
    expect(fc.archetype).toBe("route-handler");
  });

  it("config.ts matches config archetype in a TypeScript project", () => {
    const fc = classifySingle("src/config.ts", "typescript");
    expect(fc.archetype).toBe("config");
  });

  it("src/middleware/auth.ts matches middleware in a TypeScript project", () => {
    const fc = classifySingle("src/middleware/auth.ts", "typescript");
    expect(fc.archetype).toBe("middleware");
  });

  it("src/services/user.service.ts matches service in a TypeScript project", () => {
    const fc = classifySingle("src/services/user.service.ts", "typescript");
    expect(fc.archetype).toBe("service");
  });
});

// ── Archetype signal language field validation ───────────────────────────────

describe("archetype signal language field integrity", () => {
  it("Go-scoped signals have 'go' in their languages array", () => {
    for (const archetype of BUILTIN_ARCHETYPES) {
      for (const signal of archetype.signals) {
        if (signal.languages?.includes("go")) {
          expect(signal.languages).toContain("go");
          // Go signals should only contain "go" (not mixed with JS/TS)
          expect(signal.languages).not.toContain("typescript");
          expect(signal.languages).not.toContain("javascript");
        }
      }
    }
  });

  it("React-scoped signals have JS/TS but not 'go' in their languages array", () => {
    for (const archetype of BUILTIN_ARCHETYPES) {
      for (const signal of archetype.signals) {
        if (
          signal.languages?.includes("typescript") ||
          signal.languages?.includes("javascript")
        ) {
          expect(signal.languages).not.toContain("go");
        }
      }
    }
  });

  it("Go-specific archetypes exist for expected signal categories", () => {
    const goSignals: Array<{ archetypeId: string; kind: string; pattern: string }> = [];
    for (const archetype of BUILTIN_ARCHETYPES) {
      for (const signal of archetype.signals) {
        if (signal.languages?.includes("go")) {
          goSignals.push({ archetypeId: archetype.id, kind: signal.kind, pattern: signal.pattern });
        }
      }
    }
    // Verify we have Go signals in the expected archetypes
    const goArchetypeIds = new Set(goSignals.map((s) => s.archetypeId));
    expect(goArchetypeIds.has("entrypoint")).toBe(true);
    expect(goArchetypeIds.has("types")).toBe(true);
    expect(goArchetypeIds.has("route-handler")).toBe(true);
    expect(goArchetypeIds.has("config")).toBe(true);
    expect(goArchetypeIds.has("test-helper")).toBe(true);
  });
});
