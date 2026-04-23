/**
 * Centralized PRD file I/O for web server routes.
 *
 * Aggregates all branch-scoped `prd_{branch}_{date}.json` files plus any
 * legacy `prd.json` into a unified document for sync serving. The canonical
 * write target (`prd.json`) is kept as a fallback for the sync REST path;
 * MCP tool handlers use the async FileStore for all write operations.
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

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PRDDocument } from "./rex-gateway.js";
import { SCHEMA_VERSION, isCompatibleSchema } from "./rex-gateway.js";

/** Canonical fallback filename — used when no branch-scoped files exist. */
const PRD_FILENAME = "prd.json";

/** Pattern for branch-scoped PRD files. */
const BRANCH_PRD_RE = /^prd_(.+)_(\d{4}-\d{2}-\d{2})\.json$/;

function prdFilePath(rexDir: string): string {
  return join(rexDir, PRD_FILENAME);
}

/**
 * Discover all branch-scoped `prd_{branch}_{date}.json` files synchronously.
 * Returns filenames sorted lexicographically; excludes `prd.json` and lock/temp files.
 */
export function discoverPRDFilesSync(rexDir: string): string[] {
  try {
    return readdirSync(rexDir)
      .filter((name) => BRANCH_PRD_RE.test(name))
      .sort();
  } catch {
    return [];
  }
}

/** Check whether any PRD file exists in the given rex directory. */
export function prdExists(rexDir: string): boolean {
  const branchFiles = discoverPRDFilesSync(rexDir);
  if (branchFiles.length > 0) return true;
  return existsSync(prdFilePath(rexDir));
}

/**
 * Load and validate the aggregated PRD document synchronously.
 *
 * Reads all branch-scoped `prd_{branch}_{date}.json` files plus any legacy
 * `prd.json`. Items are merged in source order (branch files sorted
 * lexicographically, `prd.json` first when present). ID collisions across
 * files are logged as warnings but do not fail the read — the first-seen
 * item wins. Returns `null` when no PRD files exist or all are unparseable.
 */
export function loadPRDSync(rexDir: string): PRDDocument | null {
  const sources: Array<{ filename: string; doc: PRDDocument }> = [];

  // Load canonical prd.json first (its title/schema win in the merged result)
  const canonicalPath = prdFilePath(rexDir);
  if (existsSync(canonicalPath)) {
    try {
      const doc = JSON.parse(readFileSync(canonicalPath, "utf-8")) as PRDDocument;
      if (isCompatibleSchema(doc.schema)) {
        sources.push({ filename: PRD_FILENAME, doc });
      } else {
        console.warn(
          `[prd-io] Incompatible PRD schema in ${PRD_FILENAME}: found "${doc.schema ?? "(missing)"}",` +
          ` expected "${SCHEMA_VERSION}". Run "rex validate" to check your PRD.`,
        );
      }
    } catch {
      // Unparseable — skip
    }
  }

  // Load branch-scoped files
  for (const filename of discoverPRDFilesSync(rexDir)) {
    try {
      const doc = JSON.parse(readFileSync(join(rexDir, filename), "utf-8")) as PRDDocument;
      if (isCompatibleSchema(doc.schema)) {
        sources.push({ filename, doc });
      }
    } catch {
      // Unparseable — skip
    }
  }

  if (sources.length === 0) return null;

  // Merge: first source's title/schema win; items concatenated with collision detection
  const first = sources[0];
  const idToFile = new Map<string, string>();
  const allItems: PRDDocument["items"] = [];

  for (const { filename, doc } of sources) {
    for (const item of doc.items) {
      const existing = idToFile.get(item.id);
      if (existing) {
        console.warn(
          `[prd-io] ID collision: "${item.id}" appears in both "${existing}" and "${filename}". ` +
          `Using item from "${existing}".`,
        );
        continue;
      }
      idToFile.set(item.id, filename);
      allItems.push(item);
    }
  }

  return {
    schema: first.doc.schema,
    title: first.doc.title,
    items: allItems,
  };
}

/**
 * Save a PRD document to `prd.json` synchronously.
 *
 * **Note:** Retained for backward compatibility with web REST routes.
 * The MCP server uses the async FileStore for all write operations.
 * In multi-file mode this writes only to the canonical fallback file;
 * prefer using the async store when write routing across branch files matters.
 */
export function savePRDSync(rexDir: string, doc: PRDDocument): void {
  writeFileSync(prdFilePath(rexDir), JSON.stringify(doc, null, 2) + "\n");
}

/** Resolve the path to `prd.json` in the given rex directory. */
export function prdPath(rexDir: string): string {
  return prdFilePath(rexDir);
}

/**
 * Return the latest modification time across all PRD files (ms), or 0 if none exist.
 * Used by the data watcher for live-reload polling.
 */
export function prdMaxMtimeMs(rexDir: string): number {
  let max = 0;

  // Check canonical prd.json
  try {
    const mtime = statSync(prdFilePath(rexDir)).mtimeMs;
    if (mtime > max) max = mtime;
  } catch {
    // File absent — skip
  }

  // Check branch-scoped files
  for (const filename of discoverPRDFilesSync(rexDir)) {
    try {
      const mtime = statSync(join(rexDir, filename)).mtimeMs;
      if (mtime > max) max = mtime;
    } catch {
      // Skip unreadable files
    }
  }

  return max;
}
