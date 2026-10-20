#!/usr/bin/env node
/**
 * Clone the Go drift corpus at its pinned commits. Operator-run: it needs
 * the network, so no agent run and no test calls it.
 *
 *   node packages/sourcevision/scripts/go-corpus-clone.mjs
 *
 * Clones into ~/.cache/ndx-go-corpus/ (override with NDX_GO_CORPUS_DIR),
 * one directory per repository in `go-corpus.json`, each a depth-1 checkout
 * of the pinned SHA. A directory already at its SHA is left alone; one at a
 * different commit is refused rather than overwritten.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { checkedOutSha, corpusDir, loadCorpus } from "./go-corpus.mjs";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`git ${args.join(" ")} failed in ${cwd}`);
    process.exit(1);
  }
}

const root = corpusDir();
mkdirSync(root, { recursive: true });
console.log(`corpus directory: ${root}`);

for (const repo of loadCorpus()) {
  const dir = join(root, repo.name);
  if (existsSync(dir)) {
    const sha = checkedOutSha(dir);
    if (sha === repo.sha) {
      console.log(`${repo.name}: already at ${repo.sha}`);
      continue;
    }
    console.error(`${repo.name}: ${dir} exists at ${sha ?? "an unknown commit"}, not ${repo.sha}. Remove it and re-run.`);
    process.exit(1);
  }
  console.log(`${repo.name}: fetching ${repo.sha}`);
  mkdirSync(dir);
  git(dir, ["init", "--quiet"]);
  git(dir, ["remote", "add", "origin", repo.url]);
  git(dir, ["fetch", "--quiet", "--depth", "1", "origin", repo.sha]);
  git(dir, ["-c", "advice.detachedHead=false", "checkout", "--quiet", "FETCH_HEAD"]);
}
console.log("done");
