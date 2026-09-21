---
id: "62576269-9a7f-4051-8a09-05b7ff914c88"
level: "task"
title: "Write README.proposed.md instead of overwriting an existing README during ndx init"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "init"
  - "documentation"
source: "smart-add"
startedAt: "2026-06-01T15:20:01.906Z"
completedAt: "2026-06-01T15:39:01.927Z"
endedAt: "2026-06-01T15:39:01.927Z"
resolutionType: "code-change"
resolutionDetail: "generateTargetReadme now writes README.proposed.md when a case-insensitive README variant exists (overwriting prior proposed files, never reading/touching the original). Init summary surfaces a single-line diff hint via cli.js (static path) and cli-ink.js (Ink TUI Recap). 6/6 regression tests green; full suite 1 flaky-only failure unrelated to init."
acceptanceCriteria:
  - "Existing README.md (or any case-insensitive variant) is never read, modified, deleted, or overwritten by ndx init"
  - "When an existing README is detected, the synthesized content is written to README.proposed.md at the repo root"
  - "If README.proposed.md already exists from a previous run, it is overwritten with the latest synthesis (not appended)"
  - "Init console output includes a single line indicating that README.proposed.md was written and pointing users to diff it against the existing README"
  - "When --quiet/JSON output modes are active, the proposed-file path is still reported in the structured output"
description: "When `ndx init` finds an existing README in the target directory, do not modify it. Instead, write the synthesized content to README.proposed.md alongside the original so the user can diff and merge manually. Surface a clear console message pointing to the proposed file."
---
