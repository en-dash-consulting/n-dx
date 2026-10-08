/**
 * Shared by the Java drift-corpus scripts: the pinned list and where the
 * clones live. Not part of the test run.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Overrides the default corpus directory. */
export const CORPUS_DIR_ENV = "NDX_JAVA_CORPUS_DIR";

/** Machine-local and outside the repository. */
export function corpusDir(env = process.env) {
  return resolve(env[CORPUS_DIR_ENV] || join(homedir(), ".cache", "ndx-java-corpus"));
}

/** The pinned repositories: `{ name, url, sha, shape }`. */
export function loadCorpus() {
  return JSON.parse(readFileSync(join(SCRIPTS_DIR, "java-corpus.json"), "utf8")).repositories;
}

/** The command an operator runs to populate the corpus directory. */
export const CLONE_COMMAND = "node packages/sourcevision/scripts/java-corpus-clone.mjs";

const SHA = /^[0-9a-f]{40}$/;

/**
 * Commit a clone is checked out at, or undefined when the directory is not a
 * checkout. Reads `.git/HEAD` (a SHA when detached, else a branch ref that is
 * a loose ref file or a `packed-refs` line) so no git process is spawned.
 */
export function checkedOutSha(dir) {
  const gitDir = join(dir, ".git");
  const head = join(gitDir, "HEAD");
  if (!existsSync(head)) return undefined;
  const value = readFileSync(head, "utf8").trim();
  if (SHA.test(value)) return value;
  const ref = /^ref: (.+)$/.exec(value)?.[1];
  if (!ref) return undefined;
  const loose = join(gitDir, ref);
  if (existsSync(loose)) {
    const sha = readFileSync(loose, "utf8").trim();
    return SHA.test(sha) ? sha : undefined;
  }
  const packed = join(gitDir, "packed-refs");
  if (!existsSync(packed)) return undefined;
  const line = readFileSync(packed, "utf8").split("\n").find((l) => l.endsWith(` ${ref}`));
  const sha = line?.split(" ")[0];
  return sha && SHA.test(sha) ? sha : undefined;
}
