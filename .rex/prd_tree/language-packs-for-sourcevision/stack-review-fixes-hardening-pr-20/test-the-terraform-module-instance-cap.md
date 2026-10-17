---
id: "8c12e0ca-5fba-41c4-8350-1f8b44df47c8"
level: "task"
title: "Test the Terraform module-instance cap"
status: "completed"
priority: "medium"
tags:
  - "review-fixes"
  - "lang-terraform"
  - "test-coverage"
  - "pr-20"
source: "review"
startedAt: "2026-10-17T09:55:04.298Z"
completedAt: "2026-10-17T09:58:52.096Z"
endedAt: "2026-10-17T09:58:52.096Z"
resolutionType: "code-change"
resolutionDetail: "Unit test pins the module-instance cap on a 30-level two-call diamond; both cap mutations shown failing."
acceptanceCriteria:
  - "A unit test builds a 30-level two-call module diamond and asserts exactly MAX_MODULE_INSTANCES instances"
  - "The test fails if the cap check is moved or removed (shown in the log)"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Test-only unless the test exposes a bug. Show in the log that the test fails if the cap check is moved after the push or removed (revert temporarily, then restore)."}
description: "Stack review (#780, packages/lang-terraform/src/terraform-model.ts around line 691). Modules that share submodules multiply call paths: a chain of N directories, each calling the next twice, gives 2^N paths. MAX_MODULE_INSTANCES is the only bound, and the code is right today: a 30-level two-call diamond stops at exactly 10,000 instances in 5 ms. But no test under packages/lang-terraform/tests references MAX_MODULE_INSTANCES. A refactor that moves this check (after the push, or out of the loop) would hang analyze on a real repo with every test green.\n\nAdd the diamond (30 levels, two calls each) as a unit test that asserts instances.length === MAX_MODULE_INSTANCES and completes promptly. Show the test fails when the cap is broken."
lastModified: "2026-10-17T09:58:52.415Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
