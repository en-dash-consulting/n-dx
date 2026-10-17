---
id: "3c7c3ece-83a5-49ac-9358-2a0c0a1a8a9c"
level: "feature"
title: "Stack review fixes: detection, inventory and pack notices (PR 17)"
status: "completed"
priority: "high"
tags:
  - "language-packs"
  - "review-fixes"
  - "sourcevision"
  - "lang-kit"
  - "pr-17"
blockedBy:
  - "30fc7750-2ae8-4b7f-a080-27ac14949bb3"
source: "review"
startedAt: "2026-10-17T06:39:40.141Z"
completedAt: "2026-10-17T06:39:40.141Z"
endedAt: "2026-10-17T06:39:40.141Z"
resolutionType: "code-change"
resolutionDetail: "PR 17 draft #822: Terraform/TypeScript fallback (must-fix), Java build-output skips at module roots, inventory cache fingerprint, Java analysedLanguages, Ryan's missing-pack rule incl. previous-version installs; all verified byte-identical where expected against the restacked stack top."
acceptanceCriteria:
  - "A markerless repo with JS/TS files and a .tf file keeps TypeScript's skip dirs, test and generated patterns"
  - "Java build-output skips no longer hide real packages named target/build/out/generated"
  - "Incremental inventory never reuses a role computed under different classifier rules"
  - "Java is listed as analysed only when its pack ran"
  - "Missing opt-in packs produce one end-of-run hint; warnings only for listed-but-missing, refused or invalid packs"
description: "Code fixes from the 2026-10-16 stack review (#760–#807) for language detection, inventory and the notices about missing opt-in packs. These include the review's must-fix: a markerless repo with a .tf file loses the TypeScript fallback. They also implement Ryan's decided rule for missing opt-in packs. Stacked on #807 (PR 16c). Brief: workshop language-scaling/pr17-20-review-fixes-brief.md."
lastModified: "2026-10-17T06:54:36.629Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [After an n-dx upgrade, packs installed for the previous version read as missing and get only the end-of-run hint, not a warning](./after-an-n-dx-upgrade-packs-installed.md) | completed |
| [Invalidate the incremental inventory cache when classifier rules change](./invalidate-the-incremental-inventory.md) | completed |
| [Keep the TypeScript config when a markerless repo also has Terraform](./keep-the-typescript-config-when-a.md) | completed |
| [List Java as analysed only when the Java pack ran](./list-java-as-analysed-only-when-the.md) | completed |
| [loadPack can throw when `<ndx home>/packs` exists but cannot be read, breaking its never-throws contract](./loadpack-can-throw-when-ndx-home-packs.md) | completed |
| [Markerless polyglot repo with more .tf files than source loses the TypeScript fallback again (web/package.json + infra/*.tf)](./markerless-polyglot-repo-with-more-tf.md) | completed |
| [Markerless repo whose only JS/TS or Ruby-style source sits deeper than three levels, or only in skipped dirs, still loses the TS fallback to Terraform](./markerless-repo-whose-only-js-ts-or.md) | completed |
| [One rule for missing opt-in packs: warn only when something asked for is broken, else one end-of-run hint](./one-rule-for-missing-opt-in-packs-warn.md) | completed |
| [Skip Java build output only at module roots, not every directory named target, build, out or generated](./skip-java-build-output-only-at-module.md) | completed |
| [Stale-pack scan reads `.sv-pack-stage-*` and same-version copies, so a refusal can say "pack X@0.9.2 does not match @n-dx/sourcevision@0.9.2"](./stale-pack-scan-reads-sv-pack-stage.md) | completed |
