/**
 * Project profile detector.
 *
 * Inspects the project root for frameworks, release infrastructure, build
 * surfaces, and CI surfaces. Runs once per analyze and writes the result to
 * `.sourcevision/project-profile.json`. Downstream consumers (LLM finding
 * prompt, dashboards, CONTEXT.md) read the profile to ground recommendations
 * in the project's actual shape — e.g. suppress a "introduce a VERSION file"
 * finding when `releaseInfrastructure` already includes release-please.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  Inventory,
  Imports,
  ProjectProfile,
  ReleaseInfrastructure,
  ProjectSurface,
} from "../schema/v1.js";

const SCHEMA_VERSION = "1.0.0";

/** Build the project profile from inventory, imports, and on-disk probes. */
export function buildProjectProfile(
  projectDir: string,
  inventory: Inventory,
  imports: Imports,
): ProjectProfile {
  const languages = collectLanguages(inventory);
  const primaryLanguage = languages[0] ?? "unknown";
  const frameworks = detectFrameworks(projectDir, inventory, primaryLanguage);
  const releaseInfrastructure = detectReleaseInfrastructure(projectDir);
  const buildSurfaces = detectBuildSurfaces(projectDir);
  const ciSurfaces = detectCiSurfaces(projectDir);
  const importGraphQuality = classifyImportGraph(inventory, imports);

  return {
    schemaVersion: SCHEMA_VERSION,
    primaryLanguage,
    languages,
    frameworks,
    releaseInfrastructure,
    buildSurfaces,
    ciSurfaces,
    importGraphQuality,
  };
}

// ── Languages ────────────────────────────────────────────────────────────────

function collectLanguages(inventory: Inventory): string[] {
  const counts = new Map<string, number>();
  for (const file of inventory.files) {
    const lang = (file.language ?? "").toLowerCase();
    if (!lang || lang === "unknown") continue;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

// ── Import graph quality ─────────────────────────────────────────────────────

function classifyImportGraph(
  inventory: Inventory,
  imports: Imports,
): "rich" | "sparse" | "absent" {
  const edgeCount = (imports.edges?.length ?? 0);
  const fileCount = inventory.files.length;
  if (edgeCount === 0) return "absent";
  // A repo with <0.25 edges per source file has effectively no usable graph
  // — Louvain will collapse it into proximity-driven noise.
  const ratio = edgeCount / Math.max(1, fileCount);
  if (ratio < 0.25) return "sparse";
  return "rich";
}

// ── Frameworks ───────────────────────────────────────────────────────────────

function detectFrameworks(
  projectDir: string,
  inventory: Inventory,
  primaryLanguage: string,
): string[] {
  const found = new Set<string>();

  // package.json deps (TS/JS)
  const pkgPath = join(projectDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      const has = (name: string) => Object.hasOwn(deps, name);
      if (has("react")) found.add("react");
      if (has("preact")) found.add("preact");
      if (has("next")) found.add("nextjs");
      if (has("@remix-run/react")) found.add("remix");
      if (has("svelte")) found.add("svelte");
      if (has("vue")) found.add("vue");
      if (has("express")) found.add("express");
      if (has("fastify")) found.add("fastify");
      if (has("@nestjs/core")) found.add("nestjs");
      if (has("vite")) found.add("vite");
      if (has("vitest")) found.add("vitest");
    } catch { /* ignore */ }
  }

  // Swift: Package.swift / .xcodeproj / .swift files importing SwiftUI/AppKit
  if (primaryLanguage === "swift" || hasFileExt(inventory, ".swift")) {
    if (existsSync(join(projectDir, "Package.swift"))) found.add("swiftpm");
    if (anyDirEndsWith(projectDir, ".xcodeproj")) found.add("xcode");
    const importLines = sampleSwiftImports(projectDir, inventory);
    if (importLines.has("SwiftUI")) found.add("swiftui");
    if (importLines.has("AppKit")) found.add("appkit");
    if (importLines.has("UIKit")) found.add("uikit");
    if (importLines.has("Combine")) found.add("combine");
  }

  // Rust
  if (existsSync(join(projectDir, "Cargo.toml"))) found.add("cargo");

  // Python
  if (
    existsSync(join(projectDir, "pyproject.toml")) ||
    existsSync(join(projectDir, "requirements.txt"))
  ) {
    found.add("python");
  }

  // Go
  if (existsSync(join(projectDir, "go.mod"))) found.add("go-modules");

  return [...found].sort();
}

function hasFileExt(inventory: Inventory, ext: string): boolean {
  return inventory.files.some((f) => f.path.endsWith(ext));
}

function anyDirEndsWith(projectDir: string, suffix: string): boolean {
  try {
    return readdirSync(projectDir).some(
      (name) => name.endsWith(suffix) && safeIsDir(join(projectDir, name)),
    );
  } catch {
    return false;
  }
}

function safeIsDir(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

/** Read up to 40 Swift files and collect distinct `import X` modules. */
function sampleSwiftImports(projectDir: string, inventory: Inventory): Set<string> {
  const imports = new Set<string>();
  const swiftFiles = inventory.files
    .filter((f) => f.path.endsWith(".swift"))
    .slice(0, 40);
  for (const f of swiftFiles) {
    const abs = join(projectDir, f.path);
    if (!existsSync(abs)) continue;
    try {
      const head = readFileSync(abs, "utf-8").split("\n", 60);
      for (const line of head) {
        const m = /^\s*import\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
        if (m) imports.add(m[1]);
      }
    } catch { /* ignore */ }
  }
  return imports;
}

// ── Release infrastructure ───────────────────────────────────────────────────

function detectReleaseInfrastructure(projectDir: string): ReleaseInfrastructure[] {
  const found: ReleaseInfrastructure[] = [];

  const releasePleaseManifest = ".release-please-manifest.json";
  if (existsSync(join(projectDir, releasePleaseManifest))) {
    found.push({ kind: "release-please", evidence: releasePleaseManifest });
  } else if (existsSync(join(projectDir, "release-please-config.json"))) {
    found.push({ kind: "release-please", evidence: "release-please-config.json" });
  }

  if (existsSync(join(projectDir, ".changeset"))) {
    found.push({ kind: "changesets", evidence: ".changeset" });
  }

  // package.json with a version field counts even without a publish pipeline.
  const pkgPath = join(projectDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
      if (pkg.version) found.push({ kind: "package.json", evidence: "package.json" });
    } catch { /* ignore */ }
  }

  if (existsSync(join(projectDir, "Cargo.toml"))) {
    found.push({ kind: "cargo", evidence: "Cargo.toml" });
  }

  const pyprojectPath = join(projectDir, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    found.push({ kind: "pyproject", evidence: "pyproject.toml" });
  }

  // git-tag-driven build scripts: any build/release script that calls
  // `git describe` or `git tag`. We grep the heads of the obvious entry
  // points instead of every file (cheap and false-positive-resistant).
  const buildScripts = ["build.sh", "build-app.sh", "release.sh", "Makefile", "scripts/build.sh"];
  for (const rel of buildScripts) {
    const abs = join(projectDir, rel);
    if (!existsSync(abs)) continue;
    try {
      const head = readFileSync(abs, "utf-8");
      if (/git\s+describe|git\s+tag/.test(head)) {
        found.push({ kind: "git-tag", evidence: rel });
        break;
      }
    } catch { /* ignore */ }
  }

  // Plain VERSION/VERSION.txt file as last resort.
  for (const cand of ["VERSION", "VERSION.txt"]) {
    if (existsSync(join(projectDir, cand))) {
      found.push({ kind: "version-file", evidence: cand });
      break;
    }
  }

  return found;
}

// ── Build surfaces ───────────────────────────────────────────────────────────

function detectBuildSurfaces(projectDir: string): ProjectSurface[] {
  const surfaces: ProjectSurface[] = [];
  const candidates: Array<[string, string]> = [
    ["Makefile", "Makefile"],
    ["build.sh", "shell build script"],
    ["build-app.sh", "shell build script"],
    ["Package.swift", "swift package"],
    ["Cargo.toml", "cargo package"],
    ["pyproject.toml", "python package"],
    ["go.mod", "go module"],
    ["pnpm-workspace.yaml", "pnpm workspace"],
  ];
  for (const [path, kind] of candidates) {
    if (existsSync(join(projectDir, path))) surfaces.push({ path, kind });
  }
  return surfaces;
}

// ── CI surfaces ──────────────────────────────────────────────────────────────

function detectCiSurfaces(projectDir: string): ProjectSurface[] {
  const surfaces: ProjectSurface[] = [];

  const ghWorkflows = join(projectDir, ".github", "workflows");
  if (existsSync(ghWorkflows) && safeIsDir(ghWorkflows)) {
    try {
      for (const entry of readdirSync(ghWorkflows)) {
        if (/\.ya?ml$/.test(entry)) {
          surfaces.push({
            path: relative(projectDir, join(ghWorkflows, entry)),
            kind: "GitHub Actions",
          });
        }
      }
    } catch { /* ignore */ }
  }

  if (existsSync(join(projectDir, ".gitlab-ci.yml"))) {
    surfaces.push({ path: ".gitlab-ci.yml", kind: "GitLab CI" });
  }
  if (existsSync(join(projectDir, "bitbucket-pipelines.yml"))) {
    surfaces.push({ path: "bitbucket-pipelines.yml", kind: "Bitbucket Pipelines" });
  }
  if (existsSync(join(projectDir, ".circleci", "config.yml"))) {
    surfaces.push({ path: ".circleci/config.yml", kind: "CircleCI" });
  }

  return surfaces;
}
