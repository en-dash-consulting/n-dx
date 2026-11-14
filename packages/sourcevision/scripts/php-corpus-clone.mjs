#!/usr/bin/env node
/**
 * Clone the PHP drift corpus at its pinned commits. Operator-run: it needs
 * the network, so no agent run and no test calls it.
 *
 *   node packages/sourcevision/scripts/php-corpus-clone.mjs
 *
 * Clones into ~/.cache/ndx-php-corpus/ (override with NDX_PHP_CORPUS_DIR),
 * one directory per repository in `php-corpus.json`, each a depth-1 checkout
 * of the pinned SHA, as the Java corpus's `cloneCorpus` does.
 */

import { cloneCorpus } from "./java-corpus-clone.mjs";
import { corpusDir, loadCorpus } from "./php-corpus.mjs";

cloneCorpus(corpusDir(), loadCorpus());
