/**
 * Centralized PRD file I/O for web server routes.
 *
 * All web-server reads and writes of `.rex/prd.json` pass through this
 * module. This replaces scattered `readFileSync`/`writeFileSync` calls
 * across 6+ route files with a single, auditable access point.
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

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PRDDocument } from "./rex-gateway.js";
import { SCHEMA_VERSION, isCompatibleSchema } from "./rex-gateway.js";

/**
 * Check whether prd.json exists in the given rex directory.
 */
export function prdExists(rexDir: string): boolean {
  return existsSync(join(rexDir, "prd.json"));
}

/**
 * Load and parse prd.json synchronously. Returns null if not found or unparseable.
 *
 * Validates the schema version before returning. If the version is incompatible,
 * logs a warning and returns null to prevent silent data corruption from
 * operating on a document whose structure may have changed.
 */
export function loadPRDSync(rexDir: string): PRDDocument | null {
  const prdPath = join(rexDir, "prd.json");
  if (!existsSync(prdPath)) return null;
  try {
    const doc = JSON.parse(readFileSync(prdPath, "utf-8")) as PRDDocument;
    if (!isCompatibleSchema(doc.schema)) {
      console.warn(
        `[prd-io] Incompatible PRD schema: found "${doc.schema ?? "(missing)"}",` +
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
 * Save a PRD document to prd.json synchronously.
 */
export function savePRDSync(rexDir: string, doc: PRDDocument): void {
  const prdPath = join(rexDir, "prd.json");
  writeFileSync(prdPath, JSON.stringify(doc, null, 2) + "\n");
}

/**
 * Resolve the path to prd.json in the given rex directory.
 */
export function prdPath(rexDir: string): string {
  return join(rexDir, "prd.json");
}
