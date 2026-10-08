---
id: "e93f3a9f-0405-40d0-a1ad-58eb2bce2202"
level: "task"
title: "Runner memory test times out under the full test gate"
status: "pending"
priority: "high"
description: "Hench run 629c993a (task 9ac16e77) failed its gate twice on packages/sourcevision/tests/unit/language/runner.test.ts:157, 'frees trees: parsing many files does not grow memory without bound': Test timed out in 30000ms. Alone the test takes about 5 s; under the full parallel gate, with other sessions' runs on the machine, it takes more than 30 s. The test parses a 15 KB Java source 1,100 times through the real Java pack, which since PR 3 runs six structure queries on every parse, so most of its cost is query execution, not tree allocation. It will keep failing gates in both the Java and the Go/Terraform/SQL sessions.\n\nKeep what the test proves (the runner deletes every tree it creates; memory stays bounded) and make it cheap and load-insensitive: run it against a pack with no queries (or one trivial query), so it measures tree freeing rather than query cost; lower the iteration counts while keeping the deterministic Tree.prototype.delete call-count assertion as the main check; keep the external-memory bound loose enough to hold under load. Do not raise the timeout as the fix, and do not skip the test."
lastModified: "2026-10-08T03:24:10.362Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
tags:
  - "language-packs"
  - "sourcevision"
  - "tests"
source: "run-failure"
acceptanceCriteria:
  - "The memory test runs in under 2 seconds alone and passes under the full sourcevision suite"
  - "It still fails if the runner stops deleting trees (the Tree.prototype.delete call count is asserted)"
  - "It no longer depends on the Java pack's query set"
  - "The test timeout is not raised and the test is not skipped"
  - "The six static root policy tests pass"
---
