---
id: "115f26b3-76f5-4714-b171-160e12c2bcab"
type: "task"
title: "Document the test runner's validation slot"
slug: "document-the-test-runner-s-validation"
description: "PR 3 of 3 (runner takes the slot), task 2 of 2: closes PR 3 and the wave.\n\nUpdate TESTING.md: `scripts/run-all-tests.mjs` now waits for the host validation slot, nests under a hench gate that holds it, `--list` never waits, and the opt-out flag exists for a deliberate parallel run. Mention the new root drift test beside the other drift tests if TESTING.md lists them.\n\nNo changeset: the runner is repository tooling, not a published package. If a docs page is checked by a root docs test (scripts/lib/select-suites.mjs VALIDATED_DOC_PAGES), run that test."
acceptanceCriteria:
  - "TESTING.md describes the runner's slot behaviour, nesting, --list and the opt-out accurately"
  - "Root docs tests that read TESTING.md pass"
priority: "medium"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-3-runner-slot"
  - "docs"
source: "ndx-capture"
blockedBy:
  - "ee944d3b-6829-4cac-901a-427b91170c79"
---
