---
id: "eb21a965-6d17-4ee7-b6bd-0f1e6d07ff33"
level: "feature"
title: "ANSI Color Reset Consistency in Tool Output"
status: "completed"
source: "smart-add"
startedAt: "2026-04-09T18:32:06.317Z"
completedAt: "2026-04-09T18:32:06.317Z"
acceptanceCriteria: []
description: "Tool output lines using blue (and potentially other) ANSI colors do not emit a reset code at the end of the line, causing the color to bleed into subsequent terminal output. This is a correctness issue in the color formatting layer — every colorized segment must close with a reset so downstream text renders in the default terminal color."
---

## Children

| Title | Status |
|-------|--------|
| [Add regression tests for ANSI color reset and line-boundary consistency](./add-regression-tests-for-ansi-dbb2f5.md) | completed |
| [Audit and fix missing ANSI reset codes in tool and CLI output lines](./audit-and-fix-missing-ansi-5f17b7.md) | completed |
