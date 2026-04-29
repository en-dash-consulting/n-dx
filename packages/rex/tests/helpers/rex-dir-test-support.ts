import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PRDDocument } from "../../src/schema/index.js";
import { serializeDocument } from "../../src/store/markdown-serializer.js";
import { parseDocument } from "../../src/store/markdown-parser.js";

export function writePRD(dir: string, doc: PRDDocument): void {
  mkdirSync(join(dir, ".rex"), { recursive: true });
  writeFileSync(join(dir, ".rex", "prd.md"), serializeDocument(doc));
}

/**
 * Read the PRD document from `prd.md`. Mirrors the legacy `JSON.parse(readFileSync(prd.json))`
 * pattern used pervasively in tests prior to the markdown-only-writes migration.
 */
export function readPRD(dir: string): PRDDocument {
  const raw = readFileSync(join(dir, ".rex", "prd.md"), "utf-8");
  const result = parseDocument(raw);
  if (!result.ok) {
    throw new Error(`readPRD: failed to parse prd.md: ${result.error.message}`);
  }
  return result.data;
}

export function writeConfig<T extends Record<string, unknown>>(dir: string, config: T): void {
  mkdirSync(join(dir, ".rex"), { recursive: true });
  writeFileSync(join(dir, ".rex", "config.json"), JSON.stringify(config));
}
