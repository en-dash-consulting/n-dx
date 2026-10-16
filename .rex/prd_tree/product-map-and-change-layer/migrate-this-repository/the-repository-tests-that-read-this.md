---
id: "307252b3-1676-4c85-8e36-defa707e6d0b"
level: "task"
title: "The repository tests that read this repo's v1 PRD tree pass once the tree is v2"
status: "pending"
priority: "high"
tags:
  - "pr-26"
  - "lane-migration"
  - "restack-2026-10-14"
source: "restack-2026-10-14"
acceptanceCriteria:
  - "On a migrated copy of this repository (rules-only plan, then apply) the four tests pass or skip with a stated reason (rehearsal)"
  - "On this repository's current v1 tree they still pass"
description: "Found by the 2026-10-12 rehearsal and still true at the restacked stack top (rules-only rehearsal, 2026-10-15): after ndx migrate --apply on a copy of this repository, four tests that read the repository's own PRD fail, so the cut (Run the final migration on this repository) would turn CI red.\n- tests/e2e/prd-line-endings.test.js: scandir .rex/prd_tree ENOENT (the suite fails to load).\n- tests/e2e/prd-slug-conformance.test.js: 'findNonConformingSlugs reports no mismatches' (expects some v1 slugs) and 'tree-meta.json's slugRule marker equals the build's SLUG_RULE_VERSION' (no tree-meta.json on v2).\n- packages/rex/tests/unit/store/prd-model-reader.test.ts: the two golden tests ('parses this repository's tree to the same items as the v1 parser', 'names each item by its stored folder or file').\nFix: make each test read the repository's PRD in whichever layout it is in (v2: product/ and changes/; the slug rule applies through the v2 reader), or skip with a stated reason on v2; keep their v1 coverage on a fixture. Keep it minimal."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T04:52:13.172Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
