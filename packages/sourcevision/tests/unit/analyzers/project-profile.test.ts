import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildProjectProfile,
  stripProjectProfileForDisk,
} from "../../../src/analyzers/project-profile.js";
import type { Inventory, Imports } from "../../../src/schema/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeInventory(files: Array<{ path: string; language: string }>): Inventory {
  return {
    files: files.map((f) => ({
      path: f.path,
      size: 100,
      language: f.language,
      lineCount: 10,
      hash: "x",
      role: "library",
      category: "code",
    })) as Inventory["files"],
    summary: { totalFiles: files.length, totalLines: files.length * 10 } as Inventory["summary"],
  };
}

function makeImports(edges: Array<{ from: string; to: string }>): Imports {
  return {
    edges: edges.map((e) => ({ from: e.from, to: e.to, type: "static", symbols: ["*"] })) as Imports["edges"],
    external: [],
    summary: { totalEdges: edges.length, totalExternal: 0, mostImported: [] } as Imports["summary"],
  };
}

// ── buildProjectProfile ──────────────────────────────────────────────────────

describe("buildProjectProfile — primary language + languages list", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sv-pp-"));
  });

  it("orders languages primary-first by file count", () => {
    const inv = makeInventory([
      { path: "a.ts", language: "typescript" },
      { path: "b.ts", language: "typescript" },
      { path: "c.ts", language: "typescript" },
      { path: "d.swift", language: "swift" },
      { path: "e.swift", language: "swift" },
    ]);
    const profile = buildProjectProfile(dir, inv, makeImports([]));
    expect(profile.primaryLanguage).toBe("typescript");
    expect(profile.languages).toEqual(["typescript", "swift"]);
  });

  it("falls back to 'unknown' when inventory has no languages", () => {
    const profile = buildProjectProfile(dir, makeInventory([]), makeImports([]));
    expect(profile.primaryLanguage).toBe("unknown");
  });
});

describe("buildProjectProfile — importGraphQuality", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sv-pp-"));
  });

  it("returns 'absent' when there are no edges", () => {
    const inv = makeInventory([{ path: "a.swift", language: "swift" }]);
    const profile = buildProjectProfile(dir, inv, makeImports([]));
    expect(profile.importGraphQuality).toBe("absent");
  });

  it("returns 'sparse' when edges/file ratio is below 0.25", () => {
    const inv = makeInventory(
      Array.from({ length: 100 }, (_, i) => ({ path: `f${i}.ts`, language: "typescript" })),
    );
    const profile = buildProjectProfile(dir, inv, makeImports([{ from: "f0.ts", to: "f1.ts" }]));
    expect(profile.importGraphQuality).toBe("sparse");
  });

  it("returns 'rich' when edges/file ratio is at or above 0.25", () => {
    const inv = makeInventory([
      { path: "a.ts", language: "typescript" },
      { path: "b.ts", language: "typescript" },
      { path: "c.ts", language: "typescript" },
      { path: "d.ts", language: "typescript" },
    ]);
    const profile = buildProjectProfile(dir, inv, makeImports([
      { from: "a.ts", to: "b.ts" },
      { from: "b.ts", to: "c.ts" },
      { from: "c.ts", to: "d.ts" },
    ]));
    expect(profile.importGraphQuality).toBe("rich");
  });
});

describe("buildProjectProfile — framework detection", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sv-pp-"));
  });

  it("flags React / preact / express from package.json deps", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "x", version: "1.0.0",
      dependencies: { react: "^18", express: "^4" },
      devDependencies: { vitest: "^1" },
    }));
    const inv = makeInventory([{ path: "a.ts", language: "typescript" }]);
    const profile = buildProjectProfile(dir, inv, makeImports([]));
    expect(profile.frameworks).toEqual(expect.arrayContaining(["react", "express", "vitest"]));
  });

  it("detects SwiftUI/AppKit from .swift file imports", () => {
    writeFileSync(
      join(dir, "App.swift"),
      `import Foundation\nimport SwiftUI\nimport AppKit\nstruct App {}\n`,
    );
    const inv = makeInventory([{ path: "App.swift", language: "swift" }]);
    const profile = buildProjectProfile(dir, inv, makeImports([]));
    expect(profile.frameworks).toEqual(expect.arrayContaining(["swiftui", "appkit"]));
  });
});

describe("buildProjectProfile — release infrastructure", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sv-pp-"));
  });

  it("flags release-please when its manifest is present", () => {
    writeFileSync(join(dir, ".release-please-manifest.json"), `{"x": "1.0.0"}`);
    const profile = buildProjectProfile(dir, makeInventory([]), makeImports([]));
    expect(profile.releaseInfrastructure.some((r) => r.kind === "release-please")).toBe(true);
  });

  it("flags changesets when .changeset/ exists", () => {
    mkdirSync(join(dir, ".changeset"));
    const profile = buildProjectProfile(dir, makeInventory([]), makeImports([]));
    expect(profile.releaseInfrastructure.some((r) => r.kind === "changesets")).toBe(true);
  });

  it("flags package.json with a version field", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
    const profile = buildProjectProfile(dir, makeInventory([]), makeImports([]));
    expect(profile.releaseInfrastructure.some((r) => r.kind === "package.json")).toBe(true);
  });

  it("flags a build script that uses git tags as 'git-tag'", () => {
    writeFileSync(join(dir, "build-app.sh"), `#!/bin/bash\nVERSION=$(git describe --tags)\n`);
    const profile = buildProjectProfile(dir, makeInventory([]), makeImports([]));
    expect(profile.releaseInfrastructure.some((r) => r.kind === "git-tag")).toBe(true);
  });
});

describe("buildProjectProfile — build and CI surfaces", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sv-pp-"));
  });

  it("detects build surfaces (Makefile, build.sh)", () => {
    writeFileSync(join(dir, "Makefile"), "all:\n\techo hi\n");
    writeFileSync(join(dir, "build.sh"), "#!/bin/bash\n");
    const profile = buildProjectProfile(dir, makeInventory([]), makeImports([]));
    const paths = profile.buildSurfaces.map((s) => s.path);
    expect(paths).toEqual(expect.arrayContaining(["Makefile", "build.sh"]));
  });

  it("detects GitHub Actions workflows", () => {
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "name: ci\n");
    const profile = buildProjectProfile(dir, makeInventory([]), makeImports([]));
    expect(profile.ciSurfaces.some((s) => s.kind === "GitHub Actions"))
      .toBe(true);
  });
});

// ── stripProjectProfileForDisk ──────────────────────────────────────────────

describe("stripProjectProfileForDisk", () => {
  it("removes the machine-specific projectDir field", () => {
    const dir = mkdtempSync(join(tmpdir(), "sv-pp-"));
    const profile = buildProjectProfile(dir, makeInventory([]), makeImports([]));
    expect(profile.projectDir).toBe(dir);
    const stripped = stripProjectProfileForDisk(profile);
    expect(stripped).not.toHaveProperty("projectDir");
    // Other fields are preserved.
    expect(stripped.primaryLanguage).toBe(profile.primaryLanguage);
    expect(stripped.frameworks).toEqual(profile.frameworks);
  });
});
