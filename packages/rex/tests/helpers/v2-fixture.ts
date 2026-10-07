/**
 * The v2 fixture tree, copied with a chosen line ending.
 *
 * A Windows checkout (core.autocrlf=true) without an eol=lf pin hands the
 * fixture over with CRLF, so the v2 reader and writer tests run against both
 * endings rather than whatever the checkout produced. Edits made through
 * {@link editText} are written in LF terms and keep the file's own ending.
 */

import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const V2_FIXTURE = resolve(import.meta.dirname, "../fixtures/v2-tree");

export type Eol = "lf" | "crlf";
export const EOLS: readonly Eol[] = ["lf", "crlf"];

const toLf = (text: string): string => text.replace(/\r\n/g, "\n");
const withEol = (text: string, eol: Eol): string => (eol === "crlf" ? toLf(text).replace(/\n/g, "\r\n") : toLf(text));

/** Copy the v2 fixture to `dest` with every file's line endings set to `eol`. */
export async function copyV2Fixture(dest: string, eol: Eol): Promise<string> {
  await cp(V2_FIXTURE, dest, { recursive: true });
  for (const entry of await readdir(dest, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    await writeFile(path, withEol(await readFile(path, "utf-8"), eol));
  }
  return dest;
}

/** Rewrite `path` through `edit`, which sees and returns LF text; the file keeps its line ending. */
export async function editText(path: string, edit: (text: string) => string): Promise<void> {
  const text = await readFile(path, "utf-8");
  await writeFile(path, withEol(edit(toLf(text)), text.includes("\r\n") ? "crlf" : "lf"));
}
