/**
 * Shared by the Terraform drift-corpus report: the pinned list and where the
 * clones live. Not part of the test run. Checkout detection is the Java
 * corpus's `checkedOutSha`; `microservices-demo` lives in the Go corpus.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { corpusDir as goCorpusDir } from "./go-corpus.mjs";

export { checkedOutSha } from "./java-corpus.mjs";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Overrides the default IaC corpus directory. */
export const CORPUS_DIR_ENV = "NDX_IAC_CORPUS_DIR";

/** Machine-local and outside the repository. */
export function iacCorpusDir(env = process.env) {
  return resolve(env[CORPUS_DIR_ENV] || join(homedir(), ".cache", "ndx-iac-corpus"));
}

/** The pinned repositories: `{ name, corpus, url, sha, shape }`. */
export function loadCorpus() {
  return JSON.parse(readFileSync(join(SCRIPTS_DIR, "tf-corpus.json"), "utf8")).repositories;
}

/** Where a repository's checkout is expected. */
export function repoDir(repo, env = process.env) {
  return join(repo.corpus === "go" ? goCorpusDir(env) : iacCorpusDir(env), repo.name);
}

/** The commands an operator runs to put a missing repository at its pinned commit. */
export function cloneCommand(repo, env = process.env) {
  const dir = repoDir(repo, env);
  return [
    `git init --quiet ${dir}`,
    `git -C ${dir} remote add origin ${repo.url}`,
    `git -C ${dir} fetch --quiet --depth 1 origin ${repo.sha}`,
    `git -C ${dir} -c advice.detachedHead=false checkout --quiet FETCH_HEAD`,
  ].join(" && ");
}
