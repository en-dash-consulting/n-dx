---
id: "3c7c3ece-83a5-49ac-9358-2a0c0a1a8a9c"
type: "change"
title: "Stack review fixes: detection, inventory and pack notices (PR 17)"
slug: "stack-review-fixes-detection-inventory"
intent: "Code fixes from the 2026-10-16 stack review (#760–#807) for language detection, inventory and the notices about missing opt-in packs. These include the review's must-fix: a markerless repo with a .tf file loses the TypeScript fallback. They also implement Ryan's decided rule for missing opt-in packs. Stacked on #807 (PR 16c). Brief: workshop language-scaling/pr17-20-review-fixes-brief.md."
acceptanceCriteria:
  - "A markerless repo with JS/TS files and a .tf file keeps TypeScript's skip dirs, test and generated patterns"
  - "Java build-output skips no longer hide real packages named target/build/out/generated"
  - "Incremental inventory never reuses a role computed under different classifier rules"
  - "Java is listed as analysed only when its pack ran"
  - "Missing opt-in packs produce one end-of-run hint; warnings only for listed-but-missing, refused or invalid packs"
touches:
  - "6119e976-db18-4bb7-a1e1-ae6e40b7d197"
priority: "high"
tags:
  - "language-packs"
  - "review-fixes"
  - "sourcevision"
  - "lang-kit"
  - "pr-17"
source: "review"
blockedBy:
  - "30fc7750-2ae8-4b7f-a080-27ac14949bb3"
---
