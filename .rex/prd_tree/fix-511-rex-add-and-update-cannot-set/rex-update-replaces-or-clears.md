---
id: "81535cd7-a0de-4c93-b9cc-5974b3312bba"
level: "task"
title: "rex update replaces or clears acceptance criteria with --criterion and sets --source"
status: "completed"
priority: "high"
tags:
  - "fix"
  - "rex"
  - "cli"
blockedBy:
  - "673e5666-7ad9-477f-a7e4-63dca792ef36"
source: "ndx-capture"
startedAt: "2026-10-08T19:34:04.280Z"
completedAt: "2026-10-08T19:45:19.295Z"
endedAt: "2026-10-08T19:45:19.295Z"
acceptanceCriteria:
  - "`rex update <id> --criterion=\"C\" --criterion=\"D\"` leaves the item with acceptanceCriteria exactly [\"C\", \"D\"], replacing whatever was there."
  - "`rex update <id> --criterion=` clears the item's acceptance criteria, and the cleared item round-trips through the folder tree without error."
  - "`rex update <id> --source=x` sets source; `rex update <id> --source=` removes it."
  - "`rex update <id>` with only --criterion or only --source succeeds rather than reporting \"No updates specified.\""
  - "The human-readable update summary shows a criteria count or \"cleared\", not a raw array."
  - "`rex update --help` lists --criterion (replaces the list, `--criterion=` clears) and --source, with an example."
  - "A spawn-level test drives the built CLI through replace then clear and reads the item back each time."
description: "Second half of #511. Builds on the previous task's parser change (`criterion` in `MULTI_VALUE_KEYS`, `source` in `VALUE_KEYS`). Read the epic description for file locations and conventions.\n\nSemantics (mirror MCP `edit_item` in `packages/rex/src/cli/mcp-tools/edit-item.ts`, which replaces the whole list):\n- `--criterion` given one or more times → the item's `acceptanceCriteria` becomes exactly those values, in argv order, trimmed, with empty values dropped.\n- Every `--criterion` value empty (e.g. `rex update <id> --criterion=`) → the list is cleared (written as empty / absent the same way an item with no criteria is today; check what the folder-tree serializer does for `[]` vs undefined and pick the one that round-trips cleanly).\n- `--source=\"...\"` sets `source`; `--source=` on its own removes it (the same pattern as `--blockedBy=` clearing dependencies).\n- No new flag → criteria and source untouched.\n\nChanges:\n1. `packages/rex/src/cli/index.ts`: pass `multiFlags` to `cmdUpdate` (if the previous task did not already).\n2. `packages/rex/src/cli/commands/update.ts`: build `updates.acceptanceCriteria` / `updates.source` as above. Add `--criterion` and `--source` to the \"No updates specified.\" hint. The human-readable summary line (`info(... Object.entries(updates) ...)`) must render the criteria legibly — e.g. `acceptanceCriteria: 2 criteria` or `acceptanceCriteria: cleared` — not a raw comma-joined array.\n3. Help: `packages/rex/src/cli/help.ts` `update` entry — add both options (state that --criterion replaces the whole list and that `--criterion=` clears it), mention criteria and source in the description line, and add one example such as `rex update abc123 --criterion=\"Rejects an empty password\" --criterion=\"Locks after 5 failures\"`.\n\nTests:\n- Unit: `packages/rex/tests/unit/cli/commands/update.test.ts` — replace, clear, empties dropped among non-empty values, source set, source removed, and that `--criterion` alone counts as an update (no \"No updates specified.\" error).\n- Spawn-level: a real `rex update <id> --criterion=X --criterion=Y` followed by `rex update <id> --criterion=` against a temp project, reading the item's `index.md` back each time."
lastModified: "2026-10-08T19:45:19.725Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
