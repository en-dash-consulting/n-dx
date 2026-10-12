#!/usr/bin/env node
/**
 * The declaration and the snapshot come from n-dx, never from here.
 *
 * `ndx graview emit .` writes them under the project's graview dir
 * (`.ndx/graview` or `.graview`); this copies them into public/data so the
 * dev server and the build serve them at /data/. `NDX_GRAVIEW_DIR` names the
 * dir; the default is this monorepo's own `.graview`.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Default: the monorepo's own projection (`ndx graview emit .` at the repo root).
const from = resolve(process.env.NDX_GRAVIEW_DIR ?? join(root, "..", "..", ".graview"));
const to = join(root, "public", "data");

const files = ["document.json", "snapshot.json"];
const missing = files.filter((f) => !existsSync(join(from, f)));
if (missing.length > 0) {
  console.error(`sync-data: ${missing.join(" and ")} not found in ${from}.`);
  console.error("Run `ndx graview emit .` in the n-dx project first, or point NDX_GRAVIEW_DIR at its graview dir.");
  process.exit(1);
}
mkdirSync(to, { recursive: true });
for (const f of files) copyFileSync(join(from, f), join(to, f));
console.log(`sync-data: ${files.join(", ")} ← ${from}`);
