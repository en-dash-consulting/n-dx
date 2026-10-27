---
id: "cd96c72a-8003-401f-83a1-2bb70012618a"
type: "change"
title: "Detect groups of hash-suffixed same-base-title siblings in reshape pass"
slug: "detect-groups-of-hash-suffixed-same"
intent: "Add a detector to the reshape pipeline that walks each parent in the PRD folder tree and identifies clusters of two or more sibling items whose titles share the same base prefix and differ only by a trailing hash-style suffix (e.g. '-a3f2', '-b91c', short hex tokens, or whatever convention the existing hash-suffix disambiguation produces). The detector must emit a structured ConsolidationGroup per cluster with the shared base title, the member item IDs, and their bodies/descriptions so downstream steps can act on it. Reuse or extend the hash-suffix recognition logic already present from the prior 'Hash-Suffixed Duplicate Title Consolidation' work rather than reimplementing the pattern matching."
acceptanceCriteria:
  - "A pure detector function returns ConsolidationGroup[] given a parent's child list"
  - "Detector recognizes the existing hash-suffix convention used by prior disambiguation logic"
  - "Singletons (one base title, no suffixed siblings) are never grouped"
  - "Detector skips items whose suffixes are user-authored words rather than hash tokens"
  - "Unit tests cover: pure hash siblings, mixed hash+non-hash siblings, three or more members, and no-match cases"
touches:
  - "d08290fd-0664-4fb9-8881-0974b2879c50"
priority: "high"
tags:
  - "rex"
  - "reshape"
  - "consolidation"
source: "smart-add"
---
