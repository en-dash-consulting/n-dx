---
id: "4de3bd43-2d83-4a14-b953-cc9a368356ed"
level: "task"
title: "Several new tests would still pass with the behaviour they name reverted"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:medium"
  - "tests"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The workspace-header test asserts the header on prep, preview, execute and migrate requests."
  - "The run-options contract test reads source, not dist, and covers integer bounds."
  - "Tests cover control characters, prototype keys and string-typed numbers being refused."
  - "The resolve no-side-effect test seeds a session cache and asserts it survives --fresh."
  - "A prep route test goes through the server dispatcher with a /w/<key>/ path and with X-Ndx-Workspace."
description: "Verdict: should-fix (test quality).\n\n- prepare-task-modal.test.ts:255-258 'sends X-Ndx-Workspace on every request' asserts only calls[0] (the prep GET); Execute, Preview and migrate could drop the header.\n- tests/e2e/run-options-contract.test.js imports packages/web/dist/…, so it passes against a stale build; it never checks integer bounds.\n- run-options injection rules (whitespace/newline/control characters, __proto__/constructor keys, '40'/'true' as strings) are correct by code reading only; tests pin only a leading '-'.\n- run-resolve.test.ts:384 no-side-effect test passes fresh but seeds no session cache, so it would pass if resolve cleared it.\n- routes-hench-prep workspace tests build ctx directly; nothing sends a real /w/<key>/ path or X-Ndx-Workspace through start.ts.\nFix: tighten each as listed; make the contract test import source (or build first)."
lastModified: "2026-10-02T07:47:57.267Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
