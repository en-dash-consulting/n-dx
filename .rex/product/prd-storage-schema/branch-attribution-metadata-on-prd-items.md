---
id: "578686b2-4fab-45a3-a452-28a8dc45231f"
type: "capability"
title: "Branch Attribution Metadata on PRD Items"
slug: "branch-attribution-metadata-on-prd-items"
statement: "Each PRD item can record the git branch and PRD source file it was created or last changed on, and every write path fills these in automatically."
criteria: [{"id":"c1","text":"The PRD item schema shall accept optional `branch` and `sourceFile` string fields on epics, features, tasks and subtasks."},{"id":"c2","text":"When an item carrying `branch` and `sourceFile` is serialized and deserialized, rex shall keep both field values unchanged."},{"id":"c3","text":"If an item has no `branch` or `sourceFile` field, rex shall load it as valid without error."},{"id":"c4","text":"When an item has `branch` or `sourceFile` set, `rex status --format=json` shall include those fields in its output for that item."},{"id":"c5","text":"When `rex add` or `ndx add` creates an item, the command shall set the item's `branch` to the current git branch."},{"id":"c6","text":"When MCP `add_item` or `edit_item` is called, the rex MCP server shall set the item's `branch` to the git branch current at call time."},{"id":"c7","text":"When a hench run starts, hench shall set `branch` on the task it acts on to the current git branch."},{"id":"c8","text":"When `update_task_status` changes an item's status, the rex MCP server shall update the item's `branch` to the git branch active at the time of the change."},{"id":"c9","text":"If git is unavailable when an item is written, the write path shall leave out the `branch` field and complete the write without crashing."},{"id":"c10","text":"When an item is written, the write path shall set `sourceFile` to the resolved path of the active PRD file at write time."}]
source: "smart-add"
---

Extend the PRD item schema and write paths so each item records the git branch and source file it was created or last modified on, enabling provenance tracking across the tool chain.
