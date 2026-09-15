---
"@n-dx/hench": patch
---

Credit Codex file edits as livelock progress. The Codex adapter mapped only `command_execution` items to tool calls, so every command reached the livelock detector as one tool named `shell` and a patch was invisible — a normal edit-then-retest loop was killed as a livelock at the sixth identical `pnpm test`. A completed `file_change` item now becomes an `apply_patch` tool call, which is the detector's progress signal; a failed or not-yet-applied patch still is not.
