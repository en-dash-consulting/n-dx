---
id: "99c5c781-ad7e-41e4-9293-ea3f4d4894f5"
level: "feature"
title: "Forked task sessions know orientation is over and recover from a read-only refusal"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "session-fork"
source: "ndx-capture"
acceptanceCriteria:
  - "Every forked task spawn's first user turn contains a fixed sentence lifting orientation's read-only instruction"
  - "A forked attempt that produces no diff and no file-edit tool calls is reported as a read-only refusal and retried cold once in the same run"
  - "Tests exercise both behaviours using the real orientation prompt builders"
description: "A task forked from the orientation session must be told that the read-only phase has ended. When a forked attempt still treats the session as read-only, the run reports that plainly and retries once with a cold spawn instead of failing with the generic no-changes message. Workaround until this ships in the build `ndx` runs from (~/ndx-core/ndx-runner): `hench config sessionStrategy cold`."
lastModified: "2026-10-01T21:02:28.875Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Lift orientation's read-only instruction in the first turn of every forked task spawn](./lift-orientation-s-read-only.md) | completed |
| [Report a no-edit forked attempt as a read-only refusal and retry it with a cold spawn](./report-a-no-edit-forked-attempt-as-a.md) | pending |
| [Test forked spawns against the real orientation prompt for the lift and the cold retry](./test-forked-spawns-against-the-real.md) | pending |
