---
id: "efac37e0-dc05-4140-b0e1-dfb3e24b6f7e"
level: "feature"
title: "Auto-Commit on Completion for File-Modifying Claude Code Skills"
status: "completed"
source: "smart-add"
startedAt: "2026-05-28T17:52:16.724Z"
completedAt: "2026-05-28T17:52:16.724Z"
endedAt: "2026-05-28T17:52:16.724Z"
acceptanceCriteria: []
description: "Ensure that every n-dx Claude Code skill invoked outside hench run paths (e.g., simplify, code-review --fix, fewer-permission-prompts, update-config, init) stages and commits its changes immediately after completing, with a task-scoped commit message. This behavior is strictly scoped to external skill invocations — the hench agent loop has its own commit lifecycle and must not be modified."
---

## Children

| Title | Status |
|-------|--------|
| [Add regression tests verifying per-skill commit behavior and hench path isolation](./add-regression-tests-verifying-ff7940.md) | completed |
| [Audit and classify all n-dx Claude Code skills by mutation footprint](./audit-and-classify-all-n-dx-62fafb.md) | completed |
| [Implement terminal auto-commit step in each file-modifying external skill](./implement-terminal-auto-commit-51749f.md) | completed |
