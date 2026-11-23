---
id: "e33e6974-da25-45d0-ad72-4c8f053fb707"
type: "change"
title: "Streamline the codebase without changing what it outputs"
slug: "streamline-the-codebase-without"
summary: "A three-pass cleanup across every package: duplicated code becomes shared helpers, dead code goes, long functions and files are split, and repeated constants are named once. Nothing a user, test or program can observe changes."
intent: "Behaviour-preserving refactor sweep, three passes (per-directory sweep, review plus leads, cross-cutting consolidation). Shared helpers replace copy-pasted blocks, unused exports and helpers are removed, oversized functions and files are split into named pieces, scattered constants are named once, and stray doc comments are put back on their declarations. Output is pinned by the existing suites, the sourcevision golden evals and the normalized CLI smoke artifact. Behaviour bugs found along the way are reported, not fixed here."
acceptanceCriteria:
  - "Every package typechecks and its test suite passes with no test expectation changed"
  - "The normalized CLI smoke artifact matches main's"
  - "No public export is removed, and no gateway export or policy ceiling is raised"
touches:
  - "3f1ff1cf-7238-4bad-88ca-e1caf9360890"
source: "ndx-capture"
---
