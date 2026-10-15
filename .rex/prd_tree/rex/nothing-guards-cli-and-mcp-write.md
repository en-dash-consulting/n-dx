---
id: "79911152-cc98-4855-95d7-2f00f1bffe14"
level: "task"
title: "Nothing guards CLI and MCP write surfaces against new mutable PRDItem fields"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "mcp"
  - "cli"
  - "testing"
  - "regression-guard"
blockedBy:
  - "2d0cf3c4-dbb8-4aab-a500-57fcea1be005"
source: "ndx-capture"
startedAt: "2026-10-15T14:41:19.547Z"
completedAt: "2026-10-15T14:41:19.547Z"
endedAt: "2026-10-15T14:41:19.547Z"
acceptanceCriteria:
  - "The existing state is established first: whether the assertion promised by `8fc4844a` exists, and why `assignee` was not caught"
  - "A test enumerates mutable `PRDItem` / `ItemState` fields from the schema itself rather than from a hand-copied list, so a new field is picked up automatically"
  - "The test fails when a mutable field has neither an MCP `add_item`/`edit_item` parameter nor an entry in the documented exemption list"
  - "The test covers the `rex update` flag surface (`UPDATE_FLAGS`) alongside the MCP schemas"
  - "Deliberately non-writable fields (ids, timestamps, derived rollups) sit in an explicit exemption list with a comment saying why each is exempt"
  - "Adding `assignee` to the write surfaces makes the test pass without touching the exemption list, proving the guard catches the real case"
description: "A mutable field can be added to the item schema and reach the store without any CLI flag or MCP parameter ever being added for it. Nothing fails when that happens, so the gap is only discovered when someone tries to set the field and finds hand-editing frontmatter is the only route.\n\n`assignee` is the live example (see the sibling task on the missing write path), and #630 hit the same wall.\n\nThis is a regression guard, not a re-audit. The audit was already done and closed: the feature \"Audit MCP tool schemas against PRDItem fields\" (`8fc4844a-d6f9-480e-94c6-c8536f89c207`, this epic) completed 2026-03-24 carrying the acceptance criterion \"A test asserts that the MCP tool schema keys are a superset of PRDItem mutable fields\". `assignee` slipped through anyway, so that assertion is either missing, scoped too narrowly, or was never written. Establish what exists before adding to it.\n\nSurfaces the guard should cover:\n- MCP `add_item` and `edit_item` zod schemas (`packages/rex/src/cli/mcp-tools/`).\n- `rex update` flags — `UPDATE_FLAGS` in `packages/rex/src/cli/validate-input.ts:133`.\n- Optionally the dashboard's `PATCHABLE_FIELDS` (`packages/web/src/server/routes-rex/items.ts:125-128`), though a web-side assertion crosses a package boundary and may belong in the web suite instead.\n\nThe guard needs an explicit, reviewable exemption list: some schema fields are deliberately not operator-writable (`id`, `level` ordering invariants, timestamps such as `startedAt`/`completedAt`/`lastModified`, and derived status rollups). The point is that adding a field forces a deliberate choice between \"expose it\" and \"exempt it\", rather than silently defaulting to neither."
lastModified: "2026-10-15T14:41:20.147Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
