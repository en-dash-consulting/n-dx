---
id: "8729e623-60fc-4a33-b433-6514a50885c0"
level: "task"
title: "VALIDATED_DOC_PAGES is hand-maintained: a root test that starts reading a new docs page selects nothing until someone adds a group"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A unit test fails when a root test outside ROOT_DOCS_TEST_FILES/ROOT_DRIFT_TEST_FILES reads a docs/ or root README.md page that no VALIDATED_DOC_PAGES group maps to a subset running that test"
  - "Removing tests/e2e/docs-command-refs.test.js from ROOT_DOCS_TEST_FILES and its group makes a unit test fail"
  - "The group-mapping unit test's name matches what it asserts"
description: "Found by the adversarial review of task 7b0b3d72 (root-docs subset). Verdict: should-fix, low.\n\nFailure: scripts/lib/select-suites.mjs VALIDATED_DOC_PAGES maps docs pages to root-docs/root-drift by hand-written predicates. Nothing checks those predicates against what the tests actually read. The review proved it twice: the first version left out tests/e2e/docs-command-refs.test.js, which walks docs/index.md, docs/guide/** and docs/packages/**, so pages such as docs/guide/concepts/glossary.md, docs/packages/rex.md and docs/guide/skills.md selected nothing (fixed in the same change). A full-root test that starts reading another page (for example docs/contributing/*.md) or a new docs test would repeat the gap: the gate goes green and CI fails. In tests/unit/select-suites.test.js the test \"maps each group to a subset that runs tests which exist and read a page it matches\" checks only that the tests exist and are in the subset. It never checks the \"read a page it matches\" part of its name.\n\nReachable through hench's scoped gate (run-all-tests.mjs affected) on any docs-only task. CI catches it after the run.\n\nOptions:\nA (recommended): a unit test that scans every root test outside the subsets for docs paths it reads (quoted \"README.md\", \"docs/...\" literals or join(ROOT, \"docs\", …) segments) and requires each to match a VALIDATED_DOC_PAGES group whose tests include that file. Also check, for each group, that each listed test's source mentions a path the predicate matches. Cost: one test plus heuristics for walk-based reads (docs-command-refs, docs-skill-refs read directories, not files).\nB: rename the test so it claims only what it checks, and document the manual step in TESTING.md. Cheap, but the gap stays."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T06:43:59.867Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
