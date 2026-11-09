---
id: "fd199c87-7456-441e-90ea-122f5daf354e"
type: "change"
title: "Review fixes for the trust strip PR (#1013): sources stay paths, and the CSS test escapes its regex"
slug: "review-fixes-for-the-trust-strip-pr"
intent: "Review of #1013 (2026-11-09). (1) Ryan's should-fix at packages/llm-client/src/repo-trust.ts:1157: `RepoExecutionConfig.sources` meant \"which files were read\", but a6a7c43d put a glob-plus-prose entry in it (`.rex/changes/** (177 PRD items with saved run settings)`). sourcevision's readiness score turns every source into `SdlcEvidence.path`, so `get_readiness`, the scorecard and the dashboard's Delivery evidence list report that string as a file path, and the strip has to recognise the entry by matching llm-client's wording (`GROUPED_PRD_SOURCE`). (2) CodeQL \"Incomplete string escaping\" at packages/web/tests/unit/viewer/repo-trust-css.test.ts:12: the selector-to-regex helper escapes only dots, not backslashes or other metacharacters."
acceptanceCriteria:
  - "Both #1013 review threads are fixed: `sources` holds only real paths, and the CSS test escapes the whole regex metacharacter set"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
discoveredFrom: {"item":"a6a7c43d-5d1e-47f0-bf4f-c6e334ea78d1"}
source: "ndx-capture"
---
