---
id: "99c5c781-ad7e-41e4-9293-ea3f4d4894f5"
type: "task"
title: "Forked task sessions know orientation is over and recover from a read-only refusal"
slug: "forked-task-sessions-know-orientation"
description: "A task forked from the orientation session must be told that the read-only phase has ended. When a forked attempt still treats the session as read-only, the run reports that plainly and retries once with a cold spawn instead of failing with the generic no-changes message. Workaround until this ships in the build `ndx` runs from (~/ndx-core/ndx-runner): `hench config sessionStrategy cold`."
acceptanceCriteria:
  - "Every forked task spawn's first user turn contains a fixed sentence lifting orientation's read-only instruction"
  - "A forked attempt that produces no diff and no file-edit tool calls is reported as a read-only refusal and retried cold once in the same run"
  - "Tests exercise both behaviours using the real orientation prompt builders"
priority: "high"
tags:
  - "hench"
  - "session-fork"
source: "ndx-capture"
---
