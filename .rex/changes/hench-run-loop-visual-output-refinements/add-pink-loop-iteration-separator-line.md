---
id: "62f1d0e6-b4d7-408d-9fcd-64b6bd7c05ff"
type: "task"
title: "Add pink loop-iteration separator line to hench run output"
slug: "add-pink-loop-iteration-separator-line"
description: "Print a horizontal separator line in pink/magenta at each loop-iteration boundary (after run-complete) to visually distinguish loop boundaries from individual agent-turn separators. The separator width should match the existing agent-turn separator so the transcript is consistently structured. This makes it easy to scan which work happened in which iteration of a multi-loop hench run."
acceptanceCriteria:
  - "A separator line is emitted after each loop-iteration boundary in hench run output"
  - "The separator renders in pink/magenta (colorPink or nearest STATUS_COLORS equivalent) in TTY contexts"
  - "The separator character width is consistent with the existing agent-turn separator line"
  - "The separator is fully suppressed (no characters, no newline artifact) when NO_COLOR=1 or stdout is not a TTY"
  - "An integration or e2e test verifies separator presence in TTY mode and full suppression under NO_COLOR"
priority: "low"
tags:
  - "hench"
  - "cli"
  - "color"
  - "ux"
source: "smart-add"
log: "Added colorPink (magenta/35m) primitive to llm-client help-format.ts and exported through public.ts. Re-exported magenta and colorPink through hench llm-gateway.ts. Added formatLoopIterationSeparator() helper to run.ts that returns 60 × ─ in colorPink. Emits separator at end of each loop iteration (after pause) guarded by isColorEnabled() for full suppression when NO_COLOR=1 or non-TTY. Added 5-case test suite in run-colors.test.ts: magenta ANSI code present under FORCE_COLOR=1, 60-char width under NO_COLOR=1, no ANSI codes under NO_COLOR=1, isColorEnabled()=false under NO_COLOR=1, isColorEnabled()=true under FORCE_COLOR=1."
---
