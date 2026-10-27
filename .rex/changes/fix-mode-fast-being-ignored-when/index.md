---
id: "0f8711c6-1dc3-4e54-b156-54579f60771f"
type: "change"
title: "Fix --mode=fast being ignored when --accept is passed to reorganize"
slug: "fix-mode-fast-being-ignored-when"
intent: "Running `rex reorganize --mode=fast --accept=3,4 .` still triggers the LLM analysis pass, wasting time and tokens. The --mode flag should be respected regardless of whether --accept is also passed. The LLM analysis should only run when mode is \"full\" (the default)."
acceptanceCriteria:
  - "--mode=fast with --accept skips LLM analysis entirely"
  - "--mode=fast with --accept only applies structural proposals"
  - "Default mode (full) behavior is unchanged"
touches:
  - "fdc6c3d4-34f6-4805-8473-a4e672582582"
priority: "medium"
tags:
  - "rex"
  - "bugfix"
---
