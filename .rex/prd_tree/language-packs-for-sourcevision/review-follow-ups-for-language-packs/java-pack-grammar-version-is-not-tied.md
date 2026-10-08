---
id: "a1e02321-b162-4fc0-bd5b-b7bdcbacacf4"
level: "task"
title: "Java pack grammar version is not tied to the build pin"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test fails when javaPack.grammar.version differs from GRAMMARS['tree-sitter-java'].version in scripts/build-grammars.mjs"
  - "A test fails when a pack provenance verifiedAgainst entry names a tree-sitter-java version other than the pinned one"
description: "javaPack.grammar.version and the provenance verifiedAgainst string are hardcoded to 0.23.5 in src/language/java-pack.ts. scripts/build-grammars.mjs pins the grammar separately (GRAMMARS). Bumping the pin leaves the pack, provenance and golden header claiming 0.23.5, and no test fails, so provenance can silently misstate the verified grammar."
lastModified: "2026-10-08T01:47:52.817Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
