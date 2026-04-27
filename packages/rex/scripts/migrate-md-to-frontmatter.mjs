#!/usr/bin/env node
/**
 * One-time migration: convert legacy heading+rex-meta markdown PRD files to
 * the new front-matter-canonical format.
 *
 * Usage:
 *   node packages/rex/scripts/migrate-md-to-frontmatter.mjs <path-to-prd.md> [more files...]
 *
 * Reads each file with the legacy parser (tolerant of content headings inside
 * descriptions), then writes back using the new serializer. Verifies round-trip
 * by parsing the new output before overwriting.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseLegacyDocument } from "../dist/store/legacy-markdown-parser.js";
import { serializeDocument } from "../dist/store/markdown-serializer.js";
import { parseDocument } from "../dist/store/markdown-parser.js";

async function migrateFile(path) {
  const abs = resolve(path);
  const original = await readFile(abs, "utf-8");

  console.log(`Reading ${abs} (${original.length} bytes)...`);
  const legacy = parseLegacyDocument(original);
  if (!legacy.ok) {
    console.error(`  ✗ Legacy parse failed: ${legacy.error.message}`);
    process.exitCode = 1;
    return;
  }

  const itemCount = countItems(legacy.data.items);
  console.log(`  ✓ Legacy parse: title="${legacy.data.title}", ${itemCount} items`);

  const newMd = serializeDocument(legacy.data);
  console.log(`  → New format: ${newMd.length} bytes`);

  const reparsed = parseDocument(newMd);
  if (!reparsed.ok) {
    console.error(`  ✗ Round-trip parse failed: ${reparsed.error.message}`);
    process.exitCode = 1;
    return;
  }
  const reItemCount = countItems(reparsed.data.items);
  console.log(`  ✓ Round-trip: ${reItemCount} items`);

  if (itemCount !== reItemCount) {
    console.error(`  ✗ Item count mismatch: ${itemCount} vs ${reItemCount}`);
    process.exitCode = 1;
    return;
  }

  await writeFile(abs, newMd, "utf-8");
  console.log(`  ✓ Wrote ${abs}`);
}

function countItems(items) {
  let n = 0;
  for (const item of items) {
    n++;
    if (item.children) n += countItems(item.children);
  }
  return n;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: migrate-md-to-frontmatter.mjs <path-to-prd.md> [more...]");
  process.exit(2);
}

for (const f of files) {
  await migrateFile(f);
}
