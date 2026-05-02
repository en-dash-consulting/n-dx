---
id: "e08fe050-bded-4ff2-9e4f-46d55cbfc93f"
level: "feature"
title: "Enforce Plan-to-Execution Continuity in Hench Runs"
status: "completed"
source: "smart-add"
startedAt: "2026-04-30T20:06:14.123Z"
completedAt: "2026-04-30T20:06:14.123Z"
endedAt: "2026-04-30T20:06:14.123Z"
acceptanceCriteria: []
description: "When the agent produces a plan during a task, hench must execute that plan within the same run instead of emitting the plan in the summary and terminating without code changes. Several recent runs have completed tasks by describing what they would do rather than doing it, leaving the PRD item marked complete with no corresponding implementation."
---

## Children

| Title | Status |
|-------|--------|
| [Detect plan-only completions and re-prompt the agent to execute before allowing run completion](./detect-plan-only-completions-8d4933/index.md) | completed |
| [Strengthen task-completion criteria to require evidence of code changes for code-classified tasks](./strengthen-task-completion-bad1ef/index.md) | completed |
