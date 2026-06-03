/**
 * Target-repo README generation.
 *
 * Used by `ndx init` to synthesize a README that describes the **user's
 * repository**, not the n-dx toolkit itself.  The generator derives
 * project name / description / structure from the target project's own
 * manifest (package.json, pyproject.toml, go.mod, Cargo.toml) and
 * top-level directory listing — never from n-dx's documentation.
 *
 * Two write modes:
 *   - `primary` — no README variant exists; synthesized content is
 *     written to `README.md`.
 *   - `proposed` — a case-insensitive README variant already exists;
 *     the original is left untouched and synthesized content is written
 *     to `README.proposed.md` (overwriting any prior proposed file).
 *
 * @module n-dx/readme-generator
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { basename, join, resolve } from "path";

/**
 * File extensions that identify README variants.  The base name `README`
 * (no extension) also counts.  Comparison is case-insensitive.
 */
const README_EXTENSIONS = new Set([
  "", ".md", ".markdown", ".rst", ".txt", ".adoc", ".asciidoc",
]);

/**
 * Directory names that should never appear in the user-facing structure
 * overview — these are tooling artifacts (n-dx, build outputs, VCS, etc.).
 */
const STRUCTURE_SKIP_DIRS = new Set([
  ".git", ".hg", ".svn",
  ".rex", ".hench", ".sourcevision", ".claude", ".codex", ".agents",
  "node_modules", ".pnpm-store", "bower_components",
  "dist", "build", "out", "target",
  ".next", ".nuxt", ".cache", ".turbo",
  ".venv", "venv", "__pycache__", ".pytest_cache", ".tox", ".mypy_cache",
  ".idea", ".vscode",
]);

/**
 * Detect any existing README variant in the target directory.
 *
 * Match rule: case-insensitive base name `readme`, optionally followed by
 * one of {`.md`, `.markdown`, `.rst`, `.txt`, `.adoc`, `.asciidoc`}.
 * Multi-segment extensions (e.g. `README.proposed.md`) are NOT treated as
 * README variants — the proposed-file is an n-dx artifact, not user prose.
 *
 * @param {string} dir
 * @returns {string | null}  The matched filename, or null when absent.
 */
export function findExistingReadme(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    const lower = name.toLowerCase();
    if (lower !== "readme" && !lower.startsWith("readme.")) continue;
    const ext = lower.slice("readme".length);
    if (!README_EXTENSIONS.has(ext)) continue;
    try {
      if (statSync(join(dir, name)).isFile()) return name;
    } catch {
      // race or permission error — ignore and continue
    }
  }
  return null;
}

/**
 * Best-effort read of the target project's manifest.
 *
 * Tries package.json → pyproject.toml → go.mod → Cargo.toml in order.
 * Returns the first manifest it can parse.  Missing or malformed files
 * are skipped silently.
 *
 * @param {string} dir
 * @returns {{ name: string | null, description: string | null,
 *   scripts: Record<string, string> | null, license: string | null,
 *   source: string | null }}
 */
export function readProjectManifest(dir) {
  const empty = {
    name: null, description: null, scripts: null, license: null, source: null,
  };

  // 1. package.json (Node)
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      let license = null;
      if (typeof pkg.license === "string" && pkg.license.length > 0) {
        license = pkg.license;
      } else if (pkg.license && typeof pkg.license === "object" && typeof pkg.license.type === "string") {
        // Deprecated object form: { type: "MIT", url: "..." }
        license = pkg.license.type;
      }
      return {
        name: typeof pkg.name === "string" && pkg.name.length > 0 ? pkg.name : null,
        description: typeof pkg.description === "string" && pkg.description.length > 0
          ? pkg.description
          : null,
        scripts: pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : null,
        license,
        source: "package.json",
      };
    } catch {
      // fall through to next manifest
    }
  }

  // 2. pyproject.toml (Python) — minimal scan, no full parser
  const pyPath = join(dir, "pyproject.toml");
  if (existsSync(pyPath)) {
    try {
      const py = readFileSync(pyPath, "utf-8");
      const nameMatch = py.match(/^\s*name\s*=\s*["']([^"'\n]+)["']/m);
      const descMatch = py.match(/^\s*description\s*=\s*["']([^"'\n]+)["']/m);
      // License can appear as `license = "MIT"` or `license = { text = "MIT" }`.
      const licenseStr = py.match(/^\s*license\s*=\s*["']([^"'\n]+)["']/m);
      const licenseText = py.match(/^\s*license\s*=\s*\{[^}]*text\s*=\s*["']([^"'\n]+)["']/m);
      if (nameMatch || descMatch) {
        return {
          name: nameMatch ? nameMatch[1] : null,
          description: descMatch ? descMatch[1] : null,
          scripts: null,
          license: licenseStr ? licenseStr[1] : (licenseText ? licenseText[1] : null),
          source: "pyproject.toml",
        };
      }
    } catch {
      // fall through
    }
  }

  // 3. go.mod (Go) — module path → last segment as name
  const goPath = join(dir, "go.mod");
  if (existsSync(goPath)) {
    try {
      const go = readFileSync(goPath, "utf-8");
      const m = go.match(/^module\s+(\S+)/m);
      if (m) {
        const last = m[1].split("/").filter(Boolean).pop();
        return {
          name: last || m[1],
          description: null,
          scripts: null,
          license: null,
          source: "go.mod",
        };
      }
    } catch {
      // fall through
    }
  }

  // 4. Cargo.toml (Rust)
  const cargoPath = join(dir, "Cargo.toml");
  if (existsSync(cargoPath)) {
    try {
      const cargo = readFileSync(cargoPath, "utf-8");
      const nameMatch = cargo.match(/^\s*name\s*=\s*"([^"\n]+)"/m);
      const descMatch = cargo.match(/^\s*description\s*=\s*"([^"\n]+)"/m);
      const licenseMatch = cargo.match(/^\s*license\s*=\s*"([^"\n]+)"/m);
      if (nameMatch || descMatch) {
        return {
          name: nameMatch ? nameMatch[1] : null,
          description: descMatch ? descMatch[1] : null,
          scripts: null,
          license: licenseMatch ? licenseMatch[1] : null,
          source: "Cargo.toml",
        };
      }
    } catch {
      // fall through
    }
  }

  return empty;
}

/**
 * Detect the install + test commands appropriate for the project, based on
 * its manifest source and lockfile presence.
 *
 * For Node projects, the package manager is inferred from lockfile
 * presence (pnpm-lock.yaml → pnpm, yarn.lock → yarn, bun.lockb → bun,
 * package-lock.json or default → npm). For non-Node manifests, the
 * canonical install/test commands for that ecosystem are returned.
 *
 * Returned fields:
 *   - installCommand — single-line shell command that installs dependencies
 *     (or null when no signal is available).
 *   - testCommand — single-line shell command that runs the project test
 *     suite (or null when no signal is available — Node test commands are
 *     only returned when `scripts.test` is set on the manifest).
 *
 * @param {string} dir
 * @param {{ source: string | null, scripts: Record<string, string> | null }} manifest
 * @returns {{ installCommand: string | null, testCommand: string | null,
 *   packageManager: string | null }}
 */
export function detectCommands(dir, manifest) {
  const source = manifest?.source ?? null;
  const scripts = manifest?.scripts ?? null;

  if (source === "package.json") {
    let pm = "npm";
    if (existsSync(join(dir, "pnpm-lock.yaml"))) pm = "pnpm";
    else if (existsSync(join(dir, "yarn.lock"))) pm = "yarn";
    else if (existsSync(join(dir, "bun.lockb"))) pm = "bun";
    const installCommand = pm === "yarn" ? "yarn install" : `${pm} install`;
    const hasTestScript = scripts && typeof scripts.test === "string" && scripts.test.length > 0;
    const testCommand = hasTestScript ? `${pm} test` : null;
    return { installCommand, testCommand, packageManager: pm };
  }

  if (source === "pyproject.toml") {
    let installCommand = "pip install -e .";
    if (existsSync(join(dir, "poetry.lock"))) installCommand = "poetry install";
    else if (existsSync(join(dir, "uv.lock"))) installCommand = "uv sync";
    return { installCommand, testCommand: "pytest", packageManager: null };
  }

  if (source === "go.mod") {
    return { installCommand: "go mod download", testCommand: "go test ./...", packageManager: null };
  }

  if (source === "Cargo.toml") {
    return { installCommand: "cargo build", testCommand: "cargo test", packageManager: null };
  }

  return { installCommand: null, testCommand: null, packageManager: null };
}

/**
 * Detect a license file in the project root (case-insensitive). Returns
 * the filename when found, used as a fallback signal when the manifest
 * does not declare a license.
 *
 * @param {string} dir
 * @returns {string | null}
 */
export function findLicenseFile(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    const lower = name.toLowerCase();
    if (lower === "license" || lower === "licence") return name;
    if (lower.startsWith("license.") || lower.startsWith("licence.")) return name;
  }
  return null;
}

/**
 * List user-facing top-level directories, filtering out tooling artifacts.
 *
 * @param {string} dir
 * @param {number} [limit=12]
 * @returns {string[]}
 */
export function listTopLevelDirs(dir, limit = 12) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (STRUCTURE_SKIP_DIRS.has(e.name)) continue;
    names.push(e.name);
  }
  names.sort((a, b) => a.localeCompare(b));
  return names.slice(0, limit);
}

/**
 * Compose README markdown from manifest + structure data.
 *
 * The template guarantees four sections, in this canonical order:
 *
 *   1. ## Overview      — manifest `description` or a project-name stub
 *   2. ## Quick Start   — install command (per detected package manager)
 *                         plus an optional top-level structure summary
 *   3. ## Testing       — detected test command or a stub explaining how
 *                         to wire one up
 *   4. ## License       — manifest `license` field or "See LICENSE"
 *
 * Every section emits a non-empty body even when its backing signal is
 * absent, so the four canonical headings are stable across projects.
 *
 * @param {{ projectName: string, description: string | null,
 *   scripts: Record<string, string> | null, topLevelDirs: string[],
 *   license: string | null, installCommand: string | null,
 *   testCommand: string | null, licenseFile: string | null }} input
 * @returns {string}
 */
export function composeReadme({
  projectName, description, scripts, topLevelDirs,
  license, installCommand, testCommand, licenseFile,
}) {
  const lines = [`# ${projectName}`, ""];

  // 1. Overview — from manifest description, otherwise a project-name stub.
  lines.push("## Overview", "");
  if (description && description.trim().length > 0) {
    lines.push(description.trim(), "");
  } else {
    lines.push(`Source code for the \`${projectName}\` project.`, "");
  }

  // 2. Quick Start — install command (when detectable) + structure hint.
  lines.push("## Quick Start", "");
  if (installCommand) {
    lines.push("```sh", installCommand, "```", "");
  } else {
    lines.push(
      `Clone the repository, then follow your platform's standard build steps for \`${projectName}\`.`,
      "",
    );
  }
  if (topLevelDirs.length > 0) {
    lines.push("Top-level layout:", "");
    for (const d of topLevelDirs) {
      lines.push(`- \`${d}/\``);
    }
    lines.push("");
  }

  // 3. Testing — detected test command, otherwise a stub pointing at the
  // manifest. Always populated so the heading is never followed by empty
  // body (acceptance criterion: non-empty stub when no signal exists).
  lines.push("## Testing", "");
  if (testCommand) {
    lines.push("```sh", testCommand, "```", "");
  } else {
    lines.push(
      "No test command detected. Add a test script to your project manifest and document the command here.",
      "",
    );
  }

  // 4. License — manifest `license` field, falling back to a LICENSE-file
  // hint, falling back to a generic "See LICENSE" pointer.
  lines.push("## License", "");
  if (license && license.trim().length > 0) {
    const licenseLine = licenseFile
      ? `${license.trim()} — see [${licenseFile}](./${licenseFile}) for the full text.`
      : `${license.trim()} — see LICENSE for the full text.`;
    lines.push(licenseLine, "");
  } else if (licenseFile) {
    lines.push(`See [${licenseFile}](./${licenseFile}).`, "");
  } else {
    lines.push("See LICENSE.", "");
  }

  return lines.join("\n");
}

/**
 * Generate a README for the target project.
 *
 * Behavior:
 *   - When no case-insensitive README variant exists, writes synthesized
 *     content to `README.md` and returns `{ written: true, mode: "primary" }`.
 *   - When any variant already exists, the original is **never** read,
 *     modified, deleted, or overwritten.  Instead, the synthesized
 *     content is written to `README.proposed.md` at the project root.
 *     Any pre-existing `README.proposed.md` is overwritten (not appended).
 *     Returns `{ written: true, mode: "proposed", existingReadme: "<name>" }`.
 *
 * Diff hint: callers may use the returned `existingReadme` to construct
 * a "diff README.proposed.md against <existingReadme>" hint for users.
 *
 * @param {string} dir  Project root directory.
 * @returns {{ written: boolean, path?: string, mode?: "primary" | "proposed",
 *   existingReadme?: string }}
 */
export function generateTargetReadme(dir) {
  const existing = findExistingReadme(dir);
  const manifest = readProjectManifest(dir);
  const projectName = manifest.name || basename(resolve(dir));
  const topLevelDirs = listTopLevelDirs(dir);
  const { installCommand, testCommand } = detectCommands(dir, manifest);
  const licenseFile = findLicenseFile(dir);
  const content = composeReadme({
    projectName,
    description: manifest.description,
    scripts: manifest.scripts,
    topLevelDirs,
    license: manifest.license,
    installCommand,
    testCommand,
    licenseFile,
  });

  if (existing) {
    // Existing variant must never be read, modified, deleted, or overwritten.
    // Synthesized content goes to README.proposed.md; if that file already
    // exists from a prior run, it is overwritten (not appended).
    const proposedPath = join(dir, "README.proposed.md");
    writeFileSync(proposedPath, content);
    return {
      written: true,
      path: proposedPath,
      mode: "proposed",
      existingReadme: existing,
    };
  }

  const outPath = join(dir, "README.md");
  writeFileSync(outPath, content);
  return { written: true, path: outPath, mode: "primary" };
}
