---
id: "ffa2a8cd-3a0f-4c58-baea-570eb9900f14"
level: "task"
title: "docs/guide/skills.md skill table descriptions can drift from manifest.json with no test to catch it"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "v2-hardening"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test fails when a docs/guide/skills.md table Purpose cell disagrees with that skill's manifest.json description"
  - "A change to docs/guide/skills.md alone selects the suite that runs that test (VALIDATED_ARTIFACTS in scripts/lib/select-suites.mjs)"
description: "Scenario: someone edits a skill's description in packages/core/assistant-assets/manifest.json (as 7ad7e9ff7 did for ndx-reshape) and leaves the Purpose column of the docs/guide/skills.md table alone. The table says it \"is derived from manifest.json\", but nothing checks that. docs-skill-refs only checks references, and a docs-only change selects no suite (scripts/lib/select-suites.mjs), so the drift ships. That is how the stale \"v1 PRD tree — change levels\" row lasted until task 4e4bec55. Reachability: every docs-site reader. Verdict: should-fix, low.\n\nOptions: (a) a root test that parses the skills.md table and asserts each Purpose cell equals the manifest description, or is listed as an intentional paraphrase. It is cheap, but several rows paraphrase today (ndx-status, no-plan-mode, ndx-adversarial-review), so either align them or keep an allow-list. (b) Generate the table from the manifest. That costs more and touches the docs build. Recommend (a) with the rows aligned verbatim, and add skills.md to VALIDATED_ARTIFACTS so a docs-only edit selects that test."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T04:35:59.167Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
