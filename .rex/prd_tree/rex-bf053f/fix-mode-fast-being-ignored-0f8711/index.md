---
id: "0f8711c6-1dc3-4e54-b156-54579f60771f"
level: "feature"
title: "Fix --mode=fast being ignored when --accept is passed to reorganize"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "bugfix"
startedAt: "2026-03-24T05:24:18.425Z"
completedAt: "2026-03-24T05:25:16.585Z"
acceptanceCriteria:
  - "--mode=fast with --accept skips LLM analysis entirely"
  - "--mode=fast with --accept only applies structural proposals"
  - "Default mode (full) behavior is unchanged"
description: "Running `rex reorganize --mode=fast --accept=3,4 .` still triggers the LLM analysis pass, wasting time and tokens. The --mode flag should be respected regardless of whether --accept is also passed. The LLM analysis should only run when mode is \"full\" (the default)."
---

# Fix --mode=fast being ignored when --accept is passed to reorganize

🟡 [completed]

## Summary

Running `rex reorganize --mode=fast --accept=3,4 .` still triggers the LLM analysis pass, wasting time and tokens. The --mode flag should be respected regardless of whether --accept is also passed. The LLM analysis should only run when mode is "full" (the default).

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** rex, bugfix
- **Level:** feature
- **Started:** 2026-03-24T05:24:18.425Z
- **Completed:** 2026-03-24T05:25:16.585Z
- **Duration:** < 1m
