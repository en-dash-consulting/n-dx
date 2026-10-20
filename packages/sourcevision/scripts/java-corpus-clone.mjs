#!/usr/bin/env node
/**
 * Clone the Java drift corpus at its pinned commits. Operator-run: it needs
 * the network, so no agent run and no test calls it.
 *
 *   node packages/sourcevision/scripts/java-corpus-clone.mjs
 *
 * Clones into ~/.cache/ndx-java-corpus/ (override with NDX_JAVA_CORPUS_DIR),
 * one directory per repository in `java-corpus.json`, each a depth-1 checkout
 * of the pinned SHA. A directory already at its SHA is left alone; one at a
 * different commit is refused rather than overwritten.
 *
 * {@link cloneCorpus} does the same for another corpus (the Python one).
 */

import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { checkedOutSha, corpusDir, loadCorpus } from "./java-corpus.mjs";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`git ${args.join(" ")} failed in ${cwd}`);
    process.exit(1);
  }
}

/** Clone each of `repositories` (`{ name, url, sha }`) into `root` at its pinned SHA. */
export function cloneCorpus(root, repositories) {
  mkdirSync(root, { recursive: true });
  console.log(`corpus directory: ${root}`);

  for (const repo of repositories) {
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cloneCorpus(corpusDir(), loadCorpus());
}
