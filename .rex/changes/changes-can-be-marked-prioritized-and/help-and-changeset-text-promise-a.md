---
id: "58ec1ea9-b04c-48df-83f0-3bade3a0f47c"
type: "task"
title: "Help and changeset text promise a prioritized effect on v1 epics that never happens"
slug: "help-and-changeset-text-promise-a"
summary: "The help text says marking an older-format epic as prioritized moves it up the list, but nothing on older projects reads the marker. This corrects the wording."
description: "Verdict: should-fix (severity low, docs), from the adversarial review of feat/prioritized-changes.\n\nrex update <v1-epic> --prioritized writes the flag, but nothing on v1 lists or marks it (Inbox and Changes views are v2-only; the v1 tree has no priority sort); only the detail checkbox shows it. Affected text: packages/rex/src/cli/help.ts (--prioritized[=false] line), MCP descriptions in add-item.ts and edit-item.ts, .changeset/rex-prioritized-changes.md.\n\nFix: say 'v2: listed first in the Inbox and Open changes; v1: stored only'."
acceptanceCriteria:
  - "The rex help, the add_item and edit_item tool descriptions and the changeset say the flag orders lists on v2 and is only stored on v1"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
