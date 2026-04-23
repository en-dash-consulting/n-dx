/**
 * Centralized PRD file I/O for web server routes.
 *
 * All web-server reads and writes of PRD data pass through this module,
 * which targets the single canonical `prd.json` file in `.rex/`.
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

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PRDDocument } from "./rex-gateway.js";
import { SCHEMA_VERSION, isCompatibleSchema } from "./rex-gateway.js";

const PRD_FILENAME = "prd.json";

function prdFilePath(rexDir: string): string {
  return join(rexDir, PRD_FILENAME);
}

/** Check whether `prd.json` exists in the given rex directory. */
export function prdExists(rexDir: string): boolean {
  return existsSync(prdFilePath(rexDir));
}

/**
 * Load and validate `prd.json` synchronously. Returns `null` when the
 * file is missing, unparseable, or has an incompatible schema.
 */
export function loadPRDSync(rexDir: string): PRDDocument | null {
  const filePath = prdFilePath(rexDir);
  if (!existsSync(filePath)) return null;
  try {
    const doc = JSON.parse(readFileSync(filePath, "utf-8")) as PRDDocument;
    if (!isCompatibleSchema(doc.schema)) {
      console.warn(
        `[prd-io] Incompatible PRD schema in ${PRD_FILENAME}: found "${doc.schema ?? "(missing)"}",` +
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
 * Save a PRD document to `prd.json` synchronously.
 *
 * **Note:** Retained for backward compatibility with web REST routes.
 * The MCP server uses the async store.
 */
export function savePRDSync(rexDir: string, doc: PRDDocument): void {
  writeFileSync(prdFilePath(rexDir), JSON.stringify(doc, null, 2) + "\n");
}

/** Resolve the path to `prd.json` in the given rex directory. */
export function prdPath(rexDir: string): string {
  return prdFilePath(rexDir);
}

/**
 * Return the modification time of `prd.json`, or 0 if it doesn't exist.
 * Used by the data watcher for live-reload polling.
 */
export function prdMaxMtimeMs(rexDir: string): number {
  try {
    const filePath = prdFilePath(rexDir);
    if (existsSync(filePath)) {
      return statSync(filePath).mtimeMs;
    }
  } catch {
    // ignore
  }
  return 0;
}
