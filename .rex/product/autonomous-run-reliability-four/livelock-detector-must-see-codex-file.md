---
id: "dee1d86c-6d72-4b4a-8b3c-1405acd01ae9"
type: "capability"
title: "Livelock detector must see Codex file edits as progress"
slug: "livelock-detector-must-see-codex-file"
statement: "On the Codex vendor, hench's livelock detector counts a completed Codex file change as progress, so an agent loop that edits files between identical shell commands does not count as a livelock."
criteria: [{"id":"c1","text":"When a Codex file_change item completes, the Codex adapter shall emit a tool_use event whose tool name (apply_patch) satisfies isProgressTool, with the changed paths in its input."},{"id":"c2","text":"When a tool_use for a file-writing progress tool arrives, the livelock detector shall clear its repeat history."},{"id":"c3","text":"If a run repeats the sequence of shell pnpm test followed by a file_change eight times, the livelock detector shall not fire."},{"id":"c4","text":"If a run repeats an identical shell command with no file_change between the calls, the livelock detector shall fire when the repeat count reaches the threshold."},{"id":"c5","text":"The livelock detector shall not credit shell-based file edits as progress on any vendor, and hench.livelockThreshold shall stay the setting that adjusts when it fires."},{"id":"c6","text":"When a stream captured from a real codex exec --json run is replayed through the Codex adapter, at least one line shall yield a tool_use whose tool satisfies isProgressTool."},{"id":"c7","text":"When a stream captured from a real codex exec --json run is replayed through the livelock detector, the detector shall not fire."},{"id":"c8","text":"If a Codex file_change item completes between a command_execution item's item.started and item.completed, hench shall attach the command's tool_result to the shell call and not to the apply_patch call."}]
priority: "high"
---

Follow-up to PR #370 review (finding 3). Severity: high — on the Codex vendor the detector kills a normal edit-then-retest loop as a livelock.

FAILURE SCENARIO
PROGRESS_TOOLS in packages/hench/src/agent/analysis/livelock.ts (~line 108) clears the repeat history when a file-writing tool is called. The Codex adapter (packages/hench/src/agent/lifecycle/adapters/codex-cli-adapter.ts, item.started / item.completed) maps only command_execution items to tool_use events (tool name 'shell') and returns null for file_change items, so a Codex patch is invisible. With the default threshold 6, an agent that patches, runs 'pnpm test', reads the output and patches again is stopped after six identical shell({"command":"pnpm test"}) calls within 40 — spawnWithAdapter SIGTERMs the child and processErrorResult defers the task with a livelock message, even though progress was made every cycle. Claude agents that edit via Bash (sed -i, heredocs) get no progress credit either.

SOLUTION
- In the Codex adapter, map a completed file_change item to a tool_use RuntimeEvent with a file-writing tool name that is already in PROGRESS_TOOLS (apply_patch), carrying the changed paths in input (item.changes: [{path, kind}]). Check that EventAccumulator's tool_use/tool_result pairing tolerates a tool_use with no matching result, or emit a matching tool_result.
- Document in the livelock.ts module header that shell-based edits are not credited as progress on any vendor, and that hench.livelockThreshold is the escape hatch; do not add command-string heuristics.
- Reconcile the module header's claim that 'the same tool call' is name+arguments with the Codex reality (every shell call is the same tool).

ACCEPTANCE CRITERIA
- Unit test for the Codex adapter: a file_change item.completed produces a tool_use event whose tool satisfies isProgressTool.
- Livelock unit/integration test: the sequence [shell pnpm test, file_change, shell pnpm test, file_change, ...] repeated eight times does not fire; the same sequence without file_change items fires at the threshold.
- Changeset for @n-dx/hench (patch).
