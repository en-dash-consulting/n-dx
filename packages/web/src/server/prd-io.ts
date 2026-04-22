/**
 * Centralized PRD file I/O for web server routes.
 *
 * All web-server reads and writes of PRD data pass through this module.
 * Supports both legacy single-file `prd.json` and branch-scoped
 * `prd_{branch}_{date}.json` multi-file layouts. Reads aggregate all
 * discovered files into a unified document.
 *
 * **Why sync?** HTTP route handlers in the web server use synchronous
 * patterns. Rex's canonical store API (`FileStore.loadDocument()`) is
 * async and includes schema validation + canonical JSON formatting.
 * For hot-path reads where validation overhead is unnecessary (e.g.
 * extracting stats, serving raw JSON), these sync helpers avoid the
 * async conversion cost across dozens of handler functions.
 *
 * **Future migration path:** To switch to rex's async store, update
 * this single module and convert callers to await.
 *
 * @module web/server/prd-io
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PRDDocument } from "./rex-gateway.js";
import { SCHEMA_VERSION, isCompatibleSchema, walkTree } from "./rex-gateway.js";

/** Pattern matching `prd_{branch}_{YYYY-MM-DD}.json`. */
const PRD_FILENAME_RE = /^prd_(.+)_(\d{4}-\d{2}-\d{2})\.json$/;

/**
 * Discover all branch-scoped `prd_*.json` files in the `.rex/` directory.
 *
 * Returns filenames (not full paths) sorted lexicographically.
 * Ignores the legacy `prd.json`, lock files, and temp files.
 */
export function discoverPRDFilesSync(rexDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(rexDir);
  } catch {
    return [];
  }
  return entries.filter((name) => PRD_FILENAME_RE.test(name)).sort();
}

/**
 * Check whether any PRD file exists in the given rex directory.
 * Detects both legacy `prd.json` and branch-scoped `prd_*.json` files.
 */
export function prdExists(rexDir: string): boolean {
  if (existsSync(join(rexDir, "prd.json"))) return true;
  return discoverPRDFilesSync(rexDir).length > 0;
}

/**
 * Load a single PRD file by filename. Returns null if not found or invalid.
 */
function loadSinglePRDSync(rexDir: string, filename: string): PRDDocument | null {
  const filePath = join(rexDir, filename);
  if (!existsSync(filePath)) return null;
  try {
    const doc = JSON.parse(readFileSync(filePath, "utf-8")) as PRDDocument;
    if (!isCompatibleSchema(doc.schema)) {
      console.warn(
        `[prd-io] Incompatible PRD schema in ${filename}: found "${doc.schema ?? "(missing)"}",` +
        ` expected "${SCHEMA_VERSION}". Run "rex validate" to check your PRD.`,
      );
      return null;
    }
    return doc;
  } catch {
    return null;
  }
}

/**
 * Load, validate, and aggregate PRD data from all files synchronously.
 *
 * When branch-scoped `prd_*.json` files exist, merges their item trees
 * with the legacy `prd.json` (if present) into a single unified document.
 * When only `prd.json` exists, behaves identically to the original single-file load.
 * Returns null if no PRD files found or all are unparseable.
 *
 * ID collisions across files are logged as warnings (not thrown) to keep
 * the sync read path non-fatal for dashboard rendering.
 */
export function loadPRDSync(rexDir: string): PRDDocument | null {
  const branchFiles = discoverPRDFilesSync(rexDir);

  // Fast path: no branch files, load legacy prd.json only
  if (branchFiles.length === 0) {
    return loadSinglePRDSync(rexDir, "prd.json");
  }

  // Aggregate all PRD sources
  const sources: Array<{ filename: string; doc: PRDDocument }> = [];

  // Include legacy prd.json if it exists
  const legacyDoc = loadSinglePRDSync(rexDir, "prd.json");
  if (legacyDoc) {
    sources.push({ filename: "prd.json", doc: legacyDoc });
  }

  // Load each branch-scoped file
  for (const filename of branchFiles) {
    const doc = loadSinglePRDSync(rexDir, filename);
    if (doc) {
      sources.push({ filename, doc });
    }
  }

  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0].doc;

  // Merge: use first source's metadata, combine all items
  const idToFile = new Map<string, string>();
  for (const { filename, doc } of sources) {
    for (const entry of walkTree(doc.items)) {
      const existing = idToFile.get(entry.item.id);
      if (existing) {
        console.warn(
          `[prd-io] ID collision: ${entry.item.id} in ${existing} and ${filename}`,
        );
      } else {
        idToFile.set(entry.item.id, filename);
      }
    }
  }

  return {
    ...sources[0].doc,
    items: sources.flatMap(({ doc }) => doc.items),
  };
}

/**
 * Save a PRD document to prd.json synchronously.
 *
 * **Note:** This writes the entire document to `prd.json` without
 * multi-file decomposition. For proper write-routing in multi-file
 * layouts, use the async `FileStore` API via `resolveStore()`.
 * This sync path is retained for backward compatibility with web
 * REST routes; the MCP server uses the async store.
 */
export function savePRDSync(rexDir: string, doc: PRDDocument): void {
  const legacyPath = join(rexDir, "prd.json");
  writeFileSync(legacyPath, JSON.stringify(doc, null, 2) + "\n");
}

/**
 * Resolve the path to prd.json in the given rex directory.
 *
 * @deprecated Use `prdMaxMtimeMs` for mtime tracking and `loadPRDSync`
 * for reading. This function only resolves the legacy `prd.json` path.
 */
export function prdPath(rexDir: string): string {
  return join(rexDir, "prd.json");
}

/**
 * Return the latest modification time across all PRD files.
 *
 * Checks both legacy `prd.json` and branch-scoped `prd_*.json` files.
 * Returns 0 if no PRD files exist. Used by the data watcher for
 * live-reload polling.
 */
export function prdMaxMtimeMs(rexDir: string): number {
  let maxMtime = 0;

  const legacyPath = join(rexDir, "prd.json");
  try {
    if (existsSync(legacyPath)) {
      maxMtime = Math.max(maxMtime, statSync(legacyPath).mtimeMs);
    }
  } catch { /* ignore */ }

  for (const filename of discoverPRDFilesSync(rexDir)) {
    try {
      const mtime = statSync(join(rexDir, filename)).mtimeMs;
      maxMtime = Math.max(maxMtime, mtime);
    } catch { /* ignore */ }
  }

  return maxMtime;
}
