/**
 * Shared by the PHP drift-corpus scripts: the pinned list and where the
 * clones live. Not part of the test run. Checkout detection is the Java
 * corpus's `checkedOutSha`.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export { checkedOutSha } from "./java-corpus.mjs";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Overrides the default corpus directory. */
export const CORPUS_DIR_ENV = "NDX_PHP_CORPUS_DIR";

/** Machine-local and outside the repository. */
export function corpusDir(env = process.env) {
  return resolve(env[CORPUS_DIR_ENV] || join(homedir(), ".cache", "ndx-php-corpus"));
}

/** The pinned repositories: `{ name, url, sha, php5, shape }`. */
export function loadCorpus() {
  return JSON.parse(readFileSync(join(SCRIPTS_DIR, "php-corpus.json"), "utf8")).repositories;
}

/** The command an operator runs to populate the corpus directory. */
export const CLONE_COMMAND = "node packages/sourcevision/scripts/php-corpus-clone.mjs";
