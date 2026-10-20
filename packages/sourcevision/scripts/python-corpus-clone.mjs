#!/usr/bin/env node
/**
 * Clone the Python drift corpus at its pinned commits. Operator-run: it needs
 * the network, so no agent run and no test calls it.
 *
 *   node packages/sourcevision/scripts/python-corpus-clone.mjs
 *
 * Clones into ~/.cache/ndx-python-corpus/ (override with NDX_PYTHON_CORPUS_DIR),
 * one directory per repository in `python-corpus.json`, each a depth-1
 * checkout of the pinned SHA, as the Java corpus's `cloneCorpus` does.
 */

import { cloneCorpus } from "./java-corpus-clone.mjs";
import { corpusDir, loadCorpus } from "./python-corpus.mjs";

cloneCorpus(corpusDir(), loadCorpus());
