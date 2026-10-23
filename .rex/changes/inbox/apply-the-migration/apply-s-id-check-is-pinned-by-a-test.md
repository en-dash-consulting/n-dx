---
id: "50f309c8-ad51-488d-900c-da746baf17d0"
type: "task"
title: "Apply's id check is pinned by a test, and the dry run reports v2 rule errors by rule"
slug: "apply-s-id-check-is-pinned-by-a-test"
description: "Review of #689 (2026-10-12), two should-fix findings, CONFIRMED (mutation run; read).\n\n1. The apply-level id check has no test that would catch its removal. packages/rex/src/migrations/v1-to-v2/apply.ts:493-500, 570, 588: replacing 'if (isLossless(diff)) return;' with 'return;' leaves apply.test.ts at 33/33. Only everyV1Id is tested directly. Nothing checks that apply refuses, and writes nothing, when the built or read-back tree lacks an id. The fingerprintTree/isLossless reuse is ids-only (id -> id), so 'changed' is always empty.\n\n2. Neither apply nor the dry run checks the v2 rules (apply.ts:579-590: writeAndVerify checks only read-back warnings and ids). Failure scenario: a rules-only plan is complete, so apply accepts it, yet on this repository it writes 157 capabilities with no statement (capability-statement) and 40-43 ref-resolves errors; the dry run gives no hint of the 313 errors 'rex health' then reports, so a clean dry run precedes a failing gate.\n\nFix: an apply test that injects a lost id (through the readBack mock or a mocked buildV2Tree) and asserts the refusal and an unchanged snapshot; run checkV2Rules on the read-back tree and print error and warning counts by rule in the dry run and apply output. Which rules refuse apply is a design question: report, do not refuse, unless Ryan decides otherwise."
acceptanceCriteria:
  - "An apply test injects a lost id and asserts apply refuses and the project snapshot is unchanged; it fails when the isLossless check is neutered (mutation: 'if (isLossless(diff)) return;' -> 'return;')"
  - "--apply --dry-run prints v2 rule findings by rule (counts of errors and warnings) from checkV2Rules on the rehearsed tree (test; fails at 4646976bad)"
  - "--apply prints the same by-rule counts after the switch (test)"
priority: "medium"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
  - "v2-migrate-l7"
source: "review-2026-10-12"
blockedBy:
  - "5fc180fd-0060-409f-98aa-8e0e429b54f1"
---
