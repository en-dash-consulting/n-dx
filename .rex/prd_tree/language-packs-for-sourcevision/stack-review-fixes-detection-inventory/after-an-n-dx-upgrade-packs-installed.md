---
id: "121b928b-99a1-4009-a4ab-13ba8acd5138"
level: "task"
title: "After an n-dx upgrade, packs installed for the previous version read as missing and get only the end-of-run hint, not a warning"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "sourcevision"
  - "language-packs"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With @n-dx/lang-java installed only under <ndx home>/packs/<other version>/node_modules and java not listed, analyze warns that the installed pack does not match this sourcevision and names `ndx sv pack add java`; the java id is not in the Optional packs line"
  - "With no copy of the pack under any version directory and the pack not listed, analyze still prints only the Optional packs line (no warning)"
  - "A unit test in tests/unit/language/pack-loader.test.ts covers a pack present only in a sibling version directory and fails on the current code"
description: "Verdict: should-fix (medium). Revealed by \"One rule for missing opt-in packs\" (task 2de56583, commit 720952811); the loader behaviour itself predates that task.\n\nScenario: a user runs `ndx sv pack add java` on sourcevision 0.9.1. The pack goes to `<ndx home>/packs/0.9.1/node_modules/@n-dx/lang-java`. They upgrade to 0.9.2 and do not list java in sourcevision.packs. `defaultPackDir(version)` (packages/sourcevision/src/language/pack-loader.ts) now points at `packs/0.9.2`, so `loadPack` never sees the 0.9.1 copy. Module resolution fails, the status is \"missing\", and `isSuggestedPack` returns true. Java drops to inventory-only, with only the end-of-run \"Optional packs for this repo: java\" line. Before this task the user got a per-language warning. The decided rule says an installed pack that is refused (version mismatch) must warn. A pack installed for another version is that case in substance, but the loader reports it as missing.\n\nReachable: `ndx analyze` / `sv analyze` after any n-dx upgrade, for every opt-in pack installed with `sv pack add` and not listed.\n\nOptions:\n1. (Recommended) In `loadPack`, when the pack is missing from the current version's directory, check sibling version directories under `<ndx home>/packs/` for the package. If it is there, return status \"mismatch\" with the version found, remedy `ndx sv pack add <id>`. Cost: one readdir plus existsSync per missing pack. Risk: low. `sv pack list` would also show the stale install as refused.\n2. Treat any non-empty `<ndx home>/packs/*` entry for the package as \"installed\", only in `isSuggestedPack`. Cheaper, but list and analyze would disagree.\n3. Have `sv pack add` record installed ids in a version-independent file, read by `isSuggestedPack`. More state, more drift."
lastModified: "2026-10-17T06:18:34.245Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
