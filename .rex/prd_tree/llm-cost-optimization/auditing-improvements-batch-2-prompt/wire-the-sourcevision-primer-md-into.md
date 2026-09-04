---
id: "72a49d64-47ad-4b73-bd39-490d53974aea"
level: "task"
title: "Wire the sourcevision PRIMER.md into ndx work and hench orientation"
status: "pending"
priority: "high"
startedAt: "2026-09-04T18:38:58.299Z"
acceptanceCriteria:
  - "assembleNdxContext prefers a fresh .sourcevision/PRIMER.md over CONTEXT.md and falls back when the primer is absent or its fingerprint is stale"
  - "hench's orientation prompt includes the primer so orientation confirms rather than rediscovers the repo layout"
  - "The primer's fingerprint is checked against the current manifest before use; a stale primer is ignored, not trusted"
  - "core reads the primer without importing sourcevision (orchestration tier stays spawn-only; plain file read)"
  - "A unit test covers primer-present, primer-stale, and primer-absent context assembly"
description: "sourcevision writes .sourcevision/PRIMER.md (primer.ts, context.distill). ndx work already prefers it over CONTEXT.md (pair-programming.js readContextMd), but reads it whenever the file exists with no freshness check, so a primer stamped against an older analysis is served as current. hench never reads it at all: the orientation session re-explores the repo with an LLM. Add a fingerprint check on the core side and seed the orientation prompt with a current primer. Discovered while implementing: hench sourcevisionFingerprint used an invisible NUL byte separator where sourcevision primerFingerprint uses a space, so the two hashes could never agree - fixed, with a cross-tier contract test."
lastModified: "2026-09-04T18:50:10.226Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
