---
id: "54bbe6b8-9d8a-4539-b185-3d30b352c921"
level: "task"
title: "Lift orientation's read-only instruction in the first turn of every forked task spawn"
status: "pending"
priority: "high"
tags:
  - "hench"
  - "session-fork"
  - "prompt"
source: "ndx-capture"
acceptanceCriteria:
  - "A forked task spawn's brief section starts with the exported lift constant"
  - "Cold spawns, batch resumes, retry-resumes and background-wait resumes do not get the lift sentence"
  - "The lift text contains nothing task-specific and is the same bytes for every fork"
  - "buildOrientationPrompt (with and without a primer) and buildOrientationSystemPrompt limit the read-only instruction to the orientation session"
  - "A plan-mode re-spawn of a forked attempt still carries the lift sentence"
  - "A @n-dx/hench patch changeset is included"
description: "In packages/hench/src/agent/lifecycle/cli-loop.ts, when the spawn config gets `forkSession: true` (the warm parent is being forked, not a retry-resume or a background-wait resume), put a fixed, task-free sentence before the brief section of the envelope. Example: \"Orientation is over. The read-only instruction from the orientation session no longer applies: this session must edit, test and commit to finish the task below.\" Today attempt 0 reuses `baseEnvelope` unchanged, so the forked envelope has to be built separately whenever a fork happens. The plan-mode appendix path and the retry paths must keep working.\n\nExport the sentence as a constant from orientation.ts, next to the builders it counteracts, so tests and future prompt edits keep them in step. It goes in the new user turn after the inherited transcript, so the forked prefix stays byte-identical across forks.\n\nAlso reword `buildOrientationPrompt()` and `buildOrientationSystemPrompt()` so the read-only instruction is explicitly limited to the orientation session (e.g. \"During this orientation session, do not modify anything…\"). Keep both builders free of task-specific content, per the module note. Already-cached parents keep the old wording, which is why the lift sentence is the actual fix.\n\nDo not change orientation's `permissionMode: \"plan\"` or the task spawn's own permission mode."
lastModified: "2026-10-01T21:02:40.699Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
