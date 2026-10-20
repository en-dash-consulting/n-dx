---
id: "a1e02321-b162-4fc0-bd5b-b7bdcbacacf4"
level: "task"
title: "Java pack grammar version is not tied to the build pin"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
startedAt: "2026-10-12T02:09:29.092Z"
completedAt: "2026-10-12T02:11:07.129Z"
endedAt: "2026-10-12T02:11:07.129Z"
resolutionType: "code-change"
resolutionDetail: "Added tests/unit/language/java-grammar-pin.test.ts: fails if javaPack.grammar.version or any provenance tree-sitter-java version (verifiedAgainst or source URL) differs from GRAMMARS pin."
acceptanceCriteria:
  - "A test fails when javaPack.grammar.version differs from GRAMMARS['tree-sitter-java'].version in scripts/build-grammars.mjs"
  - "A test fails when a pack provenance verifiedAgainst entry names a tree-sitter-java version other than the pinned one"
description: "javaPack.grammar.version and the provenance verifiedAgainst string are hardcoded to 0.23.5 in src/language/java-pack.ts. scripts/build-grammars.mjs pins the grammar separately (GRAMMARS). Bumping the pin leaves the pack, provenance and golden header claiming 0.23.5, and no test fails, so provenance can silently misstate the verified grammar."
lastModified: "2026-10-12T02:11:07.406Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
