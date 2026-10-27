---
id: "0290dfa2-811f-4960-9c05-310f7f867c44"
type: "task"
title: "Invalidate the incremental inventory cache when classifier rules change"
slug: "invalidate-the-incremental-inventory"
description: "Stack review (#765). On a cache hit (same mtime and size), analyzeInventory in packages/sourcevision/src/analyzers/inventory.ts (around lines 522–527) reuses the previous FileEntry as it is, role included. runInventoryPhase passes previousInventory on every run without --full, and nothing ties that cache to the classifier's rules or the sourcevision version. So a Go user upgrading with a checked-in sqlc file keeps it as source, while a fresh clone or --full marks it generated. inventory.json and classifications.json then depend on history, not content. The same path hides every role and config change in this stack from existing users: Java configs, Terraform test roles, the Python skip rules.\n\nFix: compute a fingerprint of everything that decides a file's entry. That is the sourcevision version, plus a hash of the merged language config's role-relevant rules: test/generated/config patterns, skip dirs, the conditional skip rules, and the inventory classification version if there is one. Ignore previousInventory when its fingerprint differs or is missing. Store the fingerprint outside inventory.json, in the manifest or in .sourcevision/.cache. inventory.json's bytes must not change for anyone because of this task. Repeated runs with the same rules must keep using the cache.\n\nTests: an incremental run after a config change reclassifies an unchanged file. An incremental run with unchanged rules still reuses the cache: the reader is not called, or an equivalent assertion. inventory.json is identical before and after the fingerprint lands on a fresh analyze."
acceptanceCriteria:
  - "An incremental analyze after a classifier/config or version change recomputes roles of unchanged files"
  - "With unchanged rules the cache is still used"
  - "The fingerprint lives outside inventory.json; a fresh analyze's inventory.json is byte-identical to before"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Retry after run with commit 52297967: the code is in place, but the full test gate failed on tests/e2e/cli-ci.test.js > 'sourcevision validation failure' (two tests). That fixture writes an invalid .sourcevision/inventory.json and expects `ndx ci` to fail validation. With the fingerprint, the corrupted inventory has no fingerprint, so ci's analyze now rebuilds it and validation passes. Keep the test's intent (ci must report invalid sourcevision data) without weakening it: decide whether the fixture should corrupt data that analyze does not rewrite, or whether invalid data with a matching fingerprint must still be caught. Say which, and why, in the log. Do not change what the fingerprint guards. Then run the root suite (tests/e2e/cli-ci.test.js at least) before finishing. The hench sandbox may block ~/.cache corpora; leave corpus and byte-identity checks to the session; do not capture follow-ups for them."}
tags:
  - "review-fixes"
  - "sourcevision"
  - "pr-17"
source: "review"
---
