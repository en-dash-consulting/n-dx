---
"@n-dx/hench": patch
---

Fix: full test suite gate no longer skips when the agent commits its own work or uses Claude CLI tools

The gate keyed off `structuredSummary.filesChanged`, which was empty on two distinct paths:
- The agent self-committed before the gate ran, leaving a clean working tree that the HEAD-relative diff missed
- Claude CLI tool names (Edit, Write) differ from what `buildRunSummary` recognises (write_file, str_replace_editor), so the summary was empty even with tool calls recorded

Fix: git discovery now runs unconditionally before the gate. When `startingHead` is provided it compares `<startingHead>..HEAD` for committed changes, then also picks up staged and unstaged diffs. The result is merged with whatever tool-call analysis already found. All four `finalizeRun` call sites now pass `startingHead` through.

The run summary "Changes: none" line is fixed by the same change — `formatChangeClassification` now reads from `structuredSummary.filesChanged` instead of re-deriving from tool calls.
