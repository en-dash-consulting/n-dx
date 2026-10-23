---
id: "8a558da2-8724-4e8c-8a44-42b0d70b7f5b"
type: "change"
title: "Stack review fixes: resolvers and build readers (PR 18)"
slug: "stack-review-fixes-resolvers-and-build"
intent: "Code fixes from the 2026-10-16 stack review to the language resolvers and build-file readers, including Ryan's two decided external namespaces (python: and java:). Stacked on #822 (PR 17). Brief: workshop language-scaling/pr17-20-review-fixes-brief.md."
acceptanceCriteria:
  - "Python and Java externals carry their language namespace"
  - "Java resolution prefers the referencing module and never links main to test"
  - "Go keeps imports of files over 1 MB and records replace-to-skipped-dir imports as external"
  - "Python follows re-exports through __init__.py"
  - "Gradle continuation lines and sqlc JSON arrays are read correctly"
touches:
  - "84562611-0193-412e-8642-7f5b0fab1d85"
priority: "high"
tags:
  - "language-packs"
  - "review-fixes"
  - "resolvers"
  - "pr-18"
source: "review"
blockedBy:
  - "3c7c3ece-83a5-49ac-9358-2a0c0a1a8a9c"
---
