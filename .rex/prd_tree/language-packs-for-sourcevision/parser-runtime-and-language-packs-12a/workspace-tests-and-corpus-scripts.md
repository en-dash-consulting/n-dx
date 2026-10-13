---
id: "25bbb512-0590-43b4-81f0-1d4fe5105e2e"
level: "task"
title: "Workspace tests and corpus scripts load opt-in packs from the user's real pack directory, shadowing workspace code"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "language-packs"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With a Java pack of sourcevision's version installed in <ndx home>/packs/<version>, sourcevision's tests still exercise the workspace @n-dx/lang-java (a test plants a fake pack in a temp NDX_HOME pack dir and asserts it is not used)"
  - "go-corpus-report, java-scip-compare and java-corpus-report load the packs from the workspace regardless of the user's pack directory"
description: "Verdict: should-fix (medium). Found by adversarial review of a195dc83 (474cff293).\n\nScenario: loadPack (packages/sourcevision/src/language/pack-loader.ts) looks first in defaultPackDir() = <resolveNdxHome()>/packs/<sourcevision version>. Callers that pass no loader.packDir — java-zones.test.ts and imports-go-incremental.test.ts \"through the pack\" cases, pack-paths-jsdom.test.ts, and the corpus/comparison scripts (go-corpus-report edge parity, java-scip-compare via buildPackImportGraph) — therefore use a pack installed in ~/.ndx/packs/0.9.x ahead of the workspace package. Once 12b ships the install command, a developer who installed @n-dx/lang-java@0.9.x (same version as the workspace until the next bump) gets tests and corpus numbers measured against the published pack, not the code under change: a silent wrong answer on the operator's verification gate.\n\nReachability: not today (no install command, nobody has a pack dir); becomes reachable with 12b.\n\nOptions: (1) recommended — tests set loader.packDir to an empty temp dir (or a shared test helper), and the scripts pass an explicit empty packDir or print which source each pack came from; cheap, no production change. (2) honor an env override (e.g. NDX_PACK_DIR) and set it in vitest setup — broader, adds a config surface."
lastModified: "2026-10-13T17:47:35.884Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
