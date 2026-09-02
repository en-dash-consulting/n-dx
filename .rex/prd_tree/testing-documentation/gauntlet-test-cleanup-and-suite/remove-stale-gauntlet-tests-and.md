---
id: "30852ba4-b890-4da7-8784-822f9a1c7075"
level: "task"
title: "Remove stale gauntlet tests and repurpose niche tests into broader assertions"
status: "pending"
priority: "medium"
tags:
  - "testing"
  - "gauntlet"
  - "cleanup"
source: "smart-add"
acceptanceCriteria:
  - "All stale gauntlet tests are removed and the removal is noted in the commit message with a one-line rationale per removed test"
  - "Niche tests that can be generalised are rewritten as broader assertions that cover the same concern across more inputs or platforms"
  - "Niche tests that have equivalent unit/integration coverage are deleted with a cross-reference comment in the receiving suite"
  - "The gauntlet suite still passes after cleanup on both Linux and Windows runners"
  - "Test file count and line count after cleanup is documented in the PR description as before/after"
description: "Using the classification inventory from the audit, delete test cases marked stale and convert niche cases into more general assertions where the underlying concern is worth preserving. For any niche test that cannot be generalised, evaluate whether the behaviour it exercises is better covered by an existing unit or integration test, and if so, delete the gauntlet case and add a pointer comment in the relevant unit suite. Do not delete tests whose concern is valid but whose implementation is just narrow."
lastModified: "2026-09-02T14:11:24.613Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
