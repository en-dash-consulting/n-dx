---
id: "dee1d86c-6d72-4b4a-8b3c-1405acd01ae9"
level: "task"
title: "Livelock detector must see Codex file edits as progress"
status: "completed"
priority: "high"
startedAt: "2026-09-12T08:26:38.900Z"
completedAt: "2026-09-12T08:34:41.621Z"
endedAt: "2026-09-12T08:34:41.621Z"
acceptanceCriteria: []
description: "Follow-up to PR #370 review (finding 3). Severity: high — on the Codex vendor the detector kills a normal edit-then-retest loop as a livelock.\n\nFAILURE SCENARIO\nPROGRESS_TOOLS in packages/hench/src/agent/analysis/livelock.ts (~line 108) clears the repeat history when a file-writing tool is called. The Codex adapter (packages/hench/src/agent/lifecycle/adapters/codex-cli-adapter.ts, item.started / item.completed) maps only command_execution items to tool_use events (tool name 'shell') and returns null for file_change items, so a Codex patch is invisible. With the default threshold 6, an agent that patches, runs 'pnpm test', reads the output and patches again is stopped after six identical shell({\"command\":\"pnpm test\"}) calls within 40 — spawnWithAdapter SIGTERMs the child and processErrorResult defers the task with a livelock message, even though progress was made every cycle. Claude agents that edit via Bash (sed -i, heredocs) get no progress credit either.\n\nSOLUTION\n- In the Codex adapter, map a completed file_change item to a tool_use RuntimeEvent with a file-writing tool name that is already in PROGRESS_TOOLS (apply_patch), carrying the changed paths in input (item.changes: [{path, kind}]). Check that EventAccumulator's tool_use/tool_result pairing tolerates a tool_use with no matching result, or emit a matching tool_result.\n- Document in the livelock.ts module header that shell-based edits are not credited as progress on any vendor, and that hench.livelockThreshold is the escape hatch; do not add command-string heuristics.\n- Reconcile the module header's claim that 'the same tool call' is name+arguments with the Codex reality (every shell call is the same tool).\n\nACCEPTANCE CRITERIA\n- Unit test for the Codex adapter: a file_change item.completed produces a tool_use event whose tool satisfies isProgressTool.\n- Livelock unit/integration test: the sequence [shell pnpm test, file_change, shell pnpm test, file_change, ...] repeated eight times does not fire; the same sequence without file_change items fires at the threshold.\n- Changeset for @n-dx/hench (patch)."
lastModified: "2026-09-12T08:34:41.943Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
