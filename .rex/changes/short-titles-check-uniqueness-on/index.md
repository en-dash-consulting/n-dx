---
id: "42dfda33-2261-4eeb-8402-e737f4c84196"
type: "change"
title: "Short titles: check uniqueness on rename and reopen, and show them everywhere"
slug: "short-titles-check-uniqueness-on"
summary: "Short names for work items are only checked for duplicates when one is set, and several screens still show the long title. This closes those gaps so short names stay unique and appear wherever an item is named."
intent: "Gaps left by change 87627ce2 (optional short titles). (1) Uniqueness among open items is enforced only when a short title is set. Renaming an item's title (when it has no short title, the title is its shown name), or reopening a completed item, can still produce a duplicate shown name among open items. (2) Surfaces that print a raw item title still show the full title: hench run lists, Live views, the Sidecar (including its edit card) and search results. Use the shared row-name helper there, with the full title as tooltip.\n\n(3) Added by the adversarial review of feat/short-titles (should-fix, severity low-medium): nothing detects duplicate shown names that arrive by a path with no check. Triggers: two branches or worktrees each give a different open item the short title 'Wallets', then merge (the PRD lock is per workspace, and the committed state merges cleanly); `rex import-bundle`; hand edits of the Markdown. The duplicate then stays silently, and the next re-save of either item's own unchanged short title is refused against the other. Fix: a `rex validate` (and MCP health) finding that lists open items sharing a shown name."
acceptanceCriteria:
  - "Changing an item's title is refused when it would duplicate the shown name of another open item"
  - "Reopening a completed item is refused, or asks for a new short title, when its shown name duplicates an open item's"
  - "Hench run lists, Live views, the Sidecar and search results show the short title, with the full title as tooltip"
  - "The Sidecar edit card can set and clear the short title"
  - "Tests cover the rename and reopen checks and each updated surface"
  - "rex validate and MCP health report open items that share a shown name, naming each pair"
  - "A test merges two items with the same short title into a tree and asserts rex validate reports them"
touches:
  - "2171d478-2d5b-4926-8e85-837f52c99abd"
priority: "low"
discoveredFrom: {"item":"87627ce2-d130-493b-9ad7-515cd65fc86a"}
tags:
  - "rex"
  - "web"
source: "ndx-capture"
blockedBy:
  - "87627ce2-d130-493b-9ad7-515cd65fc86a"
---
