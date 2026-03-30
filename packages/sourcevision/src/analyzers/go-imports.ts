/**
 * Go import parser.
 * Regex-based extraction of Go import statements with go.mod module path
 * resolution. Classifies imports as stdlib, third-party, or internal.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImportEdge, ImportType, ExternalImport } from "../schema/index.js";
import { toPosix } from "../util/paths.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface GoRawImport {
  /** Full import path (e.g. "fmt", "github.com/go-chi/chi/v5") */
  path: string;
  /** Alias if present (named alias, "_" for blank, "." for dot) */
  alias: string | null;
  /** Classification: "stdlib", "third-party", or "internal" */
  kind: "stdlib" | "third-party" | "internal";
}

export interface GoImportResult {
  /** Internal import edges (file → file) */
  edges: ImportEdge[];
  /** External imports (stdlib + third-party) */
  external: ExternalImport[];
}

// ── Go standard library detection ────────────────────────────────────────────

/**
 * Go stdlib packages have no dot in the first path segment.
 * e.g. "fmt", "net/http", "encoding/json" → stdlib
 *      "github.com/foo/bar" → not stdlib (has dot)
 *      "golang.org/x/text" → not stdlib (has dot)
 */
function isStdlib(importPath: string): boolean {
  const firstSegment = importPath.split("/")[0];
  return !firstSegment.includes(".");
}

// ── go.mod module path extraction ────────────────────────────────────────────

const GO_MOD_MODULE_RE = /^module\s+(\S+)/m;

/**
 * Read go.mod from the target directory and extract the module path.
 * Returns null if go.mod doesn't exist or can't be parsed.
 */
export async function readGoModulePath(targetDir: string): Promise<string | null> {
  try {
    const content = await readFile(join(targetDir, "go.mod"), "utf-8");
    const match = GO_MOD_MODULE_RE.exec(content);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── Import extraction ────────────────────────────────────────────────────────

/**
 * Strip comments from a line of Go source.
 * Handles string literals correctly — only strips comments outside strings.
 */
function stripLineComment(line: string): string {
  let inString = false;
  let stringChar = "";
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (inString) {
      if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "`") {
      inString = true;
      stringChar = ch;
      continue;
    }

    // Check for // comment
    if (ch === "/" && i + 1 < line.length && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }

  return line;
}

/**
 * Single-line import: `import "fmt"` or `import alias "pkg"`
 * Captures optional alias and the quoted import path.
 */
const SINGLE_IMPORT_RE = /^\s*import\s+(?:(\w+|_|\.)\s+)?"([^"]+)"\s*$/;

/**
 * Start of grouped import block: `import (`
 */
const IMPORT_BLOCK_START_RE = /^\s*import\s*\(\s*$/;

/**
 * Line inside a grouped import block.
 * Captures optional alias and the quoted import path.
 */
const IMPORT_LINE_RE = /^\s*(?:(\w+|_|\.)\s+)?"([^"]+)"\s*$/;

/**
 * Extract all import statements from Go source text.
 * Handles:
 * - Single-line imports: import "fmt"
 * - Grouped import blocks: import ( ... )
 * - Aliased imports: import alias "pkg"
 * - Blank imports: import _ "pkg"
 * - Dot imports: import . "pkg"
 * - Comment lines inside import blocks (ignored)
 */
export function extractGoImports(
  sourceText: string,
  filePath: string,
  modulePath: string | null,
): { raw: GoRawImport[]; edges: ImportEdge[]; external: ExternalImport[] } {
  const raw: GoRawImport[] = [];
  const lines = sourceText.split("\n");
  let inImportBlock = false;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Handle block comments (/* ... */)
    if (inBlockComment) {
      const endIdx = line.indexOf("*/");
      if (endIdx === -1) continue;
      line = line.slice(endIdx + 2);
      inBlockComment = false;
    }

    // Strip block comments that start and end on the same line
    line = line.replace(/\/\*.*?\*\//g, "");

    // Check for block comment start
    const blockStart = line.indexOf("/*");
    if (blockStart !== -1) {
      line = line.slice(0, blockStart);
      inBlockComment = true;
    }

    // Strip line comments
    line = stripLineComment(line);

    if (inImportBlock) {
      // Check for end of import block
      if (line.trim() === ")") {
        inImportBlock = false;
        continue;
      }

      // Skip empty lines
      if (line.trim() === "") continue;

      const match = IMPORT_LINE_RE.exec(line);
      if (match) {
        const alias = match[1] || null;
        const importPath = match[2];
        raw.push({
          path: importPath,
          alias,
          kind: classifyImport(importPath, modulePath),
        });
      }
      continue;
    }

    // Check for grouped import block start
    if (IMPORT_BLOCK_START_RE.test(line)) {
      inImportBlock = true;
      continue;
    }

    // Check for single-line import
    const singleMatch = SINGLE_IMPORT_RE.exec(line);
    if (singleMatch) {
      const alias = singleMatch[1] || null;
      const importPath = singleMatch[2];
      raw.push({
        path: importPath,
        alias,
        kind: classifyImport(importPath, modulePath),
      });
    }
  }

  // Build edges and external imports
  const edges: ImportEdge[] = [];
  const externalMap = new Map<string, ExternalImport>();

  for (const imp of raw) {
    if (imp.kind === "internal" && modulePath) {
      // Resolve internal import to relative directory path from project root
      const internalPath = imp.path.slice(modulePath.length + 1); // strip "module/" prefix

      edges.push({
        from: filePath,
        to: toPosix(internalPath),
        type: "static" as ImportType,
        symbols: imp.alias && imp.alias !== "_" && imp.alias !== "." ? [imp.alias] : ["*"],
      });
    } else {
      // External (stdlib or third-party)
      const pkg = imp.kind === "stdlib" ? `stdlib:${imp.path}` : imp.path;
      const existing = externalMap.get(pkg);
      if (existing) {
        if (!existing.importedBy.includes(filePath)) {
          existing.importedBy.push(filePath);
        }
      } else {
        externalMap.set(pkg, {
          package: pkg,
          importedBy: [filePath],
          symbols: ["*"],
        });
      }
    }
  }

  return {
    raw,
    edges,
    external: Array.from(externalMap.values()),
  };
}

// ── Classification ───────────────────────────────────────────────────────────

function classifyImport(
  importPath: string,
  modulePath: string | null,
): "stdlib" | "third-party" | "internal" {
  if (isStdlib(importPath)) return "stdlib";
  if (modulePath && (importPath === modulePath || importPath.startsWith(modulePath + "/"))) {
    return "internal";
  }
  return "third-party";
}
