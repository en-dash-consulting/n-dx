---
id: "ed1f0944-536d-44a4-ad18-d2f3e4827e16"
level: "feature"
title: "Codex Multi-line Token Count Parsing Fix"
status: "completed"
source: "smart-add"
startedAt: "2026-04-14T20:50:00.776Z"
completedAt: "2026-04-14T20:50:00.776Z"
acceptanceCriteria: []
description: "Codex CLI emits token usage across two lines: the label 'tokens used' on one line and the numeric count on the immediately following line. The current parser does not capture this two-line pattern, so Codex credit consumption goes unrecorded in run summaries and budget tracking."
---

## Children

| Title | Status |
|-------|--------|
| [Fix Codex output parser to capture next-line token count after 'tokens used' label](./fix-codex-output-parser-to-9c999a.md) | completed |
