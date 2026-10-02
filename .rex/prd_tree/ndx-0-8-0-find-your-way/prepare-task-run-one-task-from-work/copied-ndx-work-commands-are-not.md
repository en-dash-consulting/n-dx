---
id: "2d0088bb-02cc-404e-8f92-e7ca79a219c0"
level: "task"
title: "Copied ndx work commands are not runnable: an unquoted notes placeholder and POSIX-only quoting"
status: "pending"
priority: "low"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:low"
  - "web-viewer"
  - "hench"
  - "windows"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The copied command with notes set is valid shell syntax (test parses it with a POSIX tokenizer)."
  - "On win32 the resolve command quotes a path with spaces using double quotes; a test covers it."
description: "Verdict: should-fix. Bundled: both make a copied command fail when pasted into a shell.\n\nScenario 1: with notes set, the modal's command (components/prepare-task-model.ts:236-238) contains `--context-file=<notes-file>`; pasted into a shell, < and > are redirects ('notes-file: No such file'). Scenario 2: run-resolve.ts:357-359 single-quotes paths with spaces or backslashes, which cmd.exe and PowerShell do not understand.\n\nFix (recommended): quote the placeholder (or omit it and say notes are not in the copied command); quote per platform (double quotes on win32)."
lastModified: "2026-10-02T07:47:50.886Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
