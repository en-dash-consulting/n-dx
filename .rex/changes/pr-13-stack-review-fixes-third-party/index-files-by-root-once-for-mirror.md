---
id: "2fb45c65-85c0-42bb-8b5b-b31a62c70c1c"
type: "task"
title: "Index files by root once for mirror scoring and read third-party headers concurrently"
slug: "index-files-by-root-once-for-mirror"
summary: "Keeps the checks for duplicated folders and copied-in libraries fast on very large projects."
description: "1. `packages/sourcevision/src/analyzers/mirrors.ts`: step 2 scores each candidate root pair with `countUnder` and `matchedFiles`, both full scans of the inventory, and step 3 runs `matchedFiles` again per accepted pair. Cost is O(candidate pairs × files), bounded only by `MAX_GROUP` per hash group. Index the inventory once (files by root prefix, and by root + relative path → hash), so scoring a pair costs the size of the smaller root, not the inventory. Results must be identical. Correct the module note: say exactly what the cost is.\n2. `packages/sourcevision/src/analyzers/third-party.ts` `markThirdParty` awaits `readHeader` for every inventoried file in turn. Read headers with bounded concurrency (reuse an existing limiter in sourcevision if there is one; otherwise a small fixed pool such as 16), and only for files that a header rule can still change (skip files already marked by vendor, glob or flag). Results and their order must be identical.\n\nTests: existing mirror and third-party tests stay green with identical output; a synthetic inventory with many small duplicated files under many roots (generated in the test, no files on disk) runs the mirror pass in time proportional to the files, for example by counting calls of an injected scorer or asserting a generous time bound; a fake `readHeader` records that headers are read concurrently, capped, and not for files already marked.\n\nPatch changeset for `@n-dx/sourcevision` only if behaviour visible to users changes (it should not; a changeset line for performance is fine)."
acceptanceCriteria:
  - "Mirror detection output is identical and no longer rescans the inventory per candidate pair"
  - "Third-party marks are identical, headers are read with bounded concurrency, and already-marked files are not read"
  - "The mirrors module note states the real cost"
priority: "low"
run: {"tier":"standard","review":true,"skipTestGate":true}
tags:
  - "sourcevision"
  - "performance"
  - "php-pr13"
---
