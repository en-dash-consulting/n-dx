/**
 * Target-repo README generation.
 *
 * Used by `ndx init` to synthesize a README that describes the **user's
 * repository**, not the n-dx toolkit itself.  The generator derives
 * project name / description / structure from the target project's own
 * manifest (package.json, pyproject.toml, go.mod, Cargo.toml) and
 * top-level directory listing — never from n-dx's documentation.
 *
 * This task is responsible only for the "no README exists yet" path:
 * when any case-insensitive README variant is already present, this
 * module returns `{ written: false, reason: "existing-variant" }` and
 * leaves the project untouched.  The proposed-file fallback for the
 * "README already exists" case is owned by a sibling task.
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
 *   scripts: Record<string, string> | null, source: string | null }}
 */
export function readProjectManifest(dir) {
  const empty = { name: null, description: null, scripts: null, source: null };

  // 1. package.json (Node)
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      return {
        name: typeof pkg.name === "string" && pkg.name.length > 0 ? pkg.name : null,
        description: typeof pkg.description === "string" && pkg.description.length > 0
          ? pkg.description
          : null,
        scripts: pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : null,
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
      if (nameMatch || descMatch) {
        return {
          name: nameMatch ? nameMatch[1] : null,
          description: descMatch ? descMatch[1] : null,
          scripts: null,
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
      if (nameMatch || descMatch) {
        return {
          name: nameMatch ? nameMatch[1] : null,
          description: descMatch ? descMatch[1] : null,
          scripts: null,
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
 * Output is intentionally minimal — title, one-paragraph summary, and
 * either a structure or scripts overview (or both when available).
 *
 * @param {{ projectName: string, description: string | null,
 *   scripts: Record<string, string> | null, topLevelDirs: string[] }} input
 * @returns {string}
 */
export function composeReadme({ projectName, description, scripts, topLevelDirs }) {
  const lines = [`# ${projectName}`, ""];

  if (description && description.trim().length > 0) {
    lines.push(description.trim(), "");
  } else {
    lines.push(`Source code for the \`${projectName}\` project.`, "");
  }

  const hasScripts = scripts && Object.keys(scripts).length > 0;

  if (topLevelDirs.length > 0) {
    lines.push("## Structure", "");
    for (const d of topLevelDirs) {
      lines.push(`- \`${d}/\``);
    }
    lines.push("");
  }

  if (hasScripts) {
    lines.push("## Scripts", "");
    const keys = Object.keys(scripts);
    for (const k of keys.slice(0, 20)) {
      const cmd = scripts[k];
      if (typeof cmd !== "string") continue;
      lines.push(`- \`${k}\` — \`${cmd}\``);
    }
    lines.push("");
  }

  // Fallback: when neither structure nor scripts produced content, still
  // emit a structure-only stub so the acceptance criterion "structure or
  // scripts overview" is honored.
  if (topLevelDirs.length === 0 && !hasScripts) {
    lines.push("## Structure", "");
    lines.push("- (no top-level directories detected)", "");
  }

  return lines.join("\n");
}

/**
 * Generate a README for the target project.
 *
 * Writes `README.md` only when no case-insensitive README variant is
 * present in the target directory.  When a variant already exists this
 * function leaves the project untouched and returns
 * `{ written: false, reason: "existing-variant", existingReadme: "<name>" }`.
 * The proposed-file fallback (writing `README.proposed.md` when a
 * variant exists) is owned by a sibling task and is intentionally not
 * implemented here.
 *
 * @param {string} dir  Project root directory.
 * @returns {{ written: boolean, path?: string, mode?: "primary",
 *   reason?: "existing-variant", existingReadme?: string }}
 */
export function generateTargetReadme(dir) {
  const existing = findExistingReadme(dir);
  if (existing) {
    return { written: false, reason: "existing-variant", existingReadme: existing };
  }

  const manifest = readProjectManifest(dir);
  const projectName = manifest.name || basename(resolve(dir));
  const topLevelDirs = listTopLevelDirs(dir);
  const content = composeReadme({
    projectName,
    description: manifest.description,
    scripts: manifest.scripts,
    topLevelDirs,
  });

  const outPath = join(dir, "README.md");
  writeFileSync(outPath, content);
  return { written: true, path: outPath, mode: "primary" };
}
