---
"@n-dx/rex": patch
---

Add Asana as a work-tracking integration target. A new built-in `asana` store adapter syncs the PRD tree to tasks in an Asana project: `rex adapter add asana --token=<pat> --projectId=<gid>` configures the connection (token redacted to `REX_ASANA_TOKEN`), and `rex sync --adapter=asana` creates/updates Asana tasks through the existing `SyncEngine`, which reports per-item results. The PRD hierarchy maps onto Asana subtasks; each task's native `external` field carries the PRD item id plus level/status/priority and other PRD-only metadata, so rex-managed tasks round-trip faithfully while tasks authored in the Asana UI degrade gracefully (level inferred by depth, status from the completed flag). Kept separate from the Notion, Jira, and GitHub Projects integrations. Adds an `asana` integration schema for the web UI and folds the duplicated built-in-adapter name list into an exported `BUILT_IN_NAMES` set.
