---
id: "33f7f351-6e9d-4ed8-80fd-9d9a0a11cc5d"
type: "task"
title: "Short-title uniqueness is checked outside the PRD lock on CLI and MCP write paths"
slug: "short-title-uniqueness-is-checked"
summary: "Two near-simultaneous edits can both pass the duplicate-name check because it runs before the write is locked. This moves the check inside the lock."
description: "Verdict: should-fix (severity low, cheap), from the adversarial review of feat/short-titles.\n\nedit_item (cli/mcp-tools/edit-item.ts:306), rex update (cli/commands/update.ts:180), rex add (cli/commands/add.ts:181) and v1 add_item (cli/mcp-tools/add-item.ts:266) call store.loadDocument(), assert, then write in a separate updateItem/addItem. Only v2 addChangeNode (inside withPrdModelTransaction) and the single-item dashboard PATCH check under the lock. Trigger: MCP edit_item and a dashboard PATCH (ndx start with an MCP session is a supported pairing) setting the same name on two items within milliseconds both pass.\n\nFix: move the assert into store.withTransaction on those paths, as the PATCH route does."
acceptanceCriteria:
  - "Every write path that sets a short title runs the uniqueness check inside the same store transaction as the write"
  - "A test runs two concurrent short-title writes of the same name on different open items and asserts exactly one succeeds"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
