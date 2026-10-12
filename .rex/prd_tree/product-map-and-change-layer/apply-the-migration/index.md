---
id: "9f75db42-5061-41fc-8d7b-312846f1dc12"
level: "feature"
title: "Apply the migration"
status: "pending"
priority: "high"
tags:
  - "product-map"
  - "pr-23"
  - "lane-migration"
  - "rex"
  - "core"
blockedBy:
  - "16a680ad-40ec-43d6-a8ea-2eedbc3e0e77"
  - "8cc70b76-8b1f-4506-8f5e-799cc153468d"
  - "a7c0061e-eb80-473b-84b2-861194fbcc47"
source: "roadmap"
acceptanceCriteria: []
description: "ndx migrate --apply <plan> moves the layout, then the schema, in one transaction. Run with the strongest model tier and --review.\n\nRoadmap PR 23 · wave 3 · lane migration."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-09T15:13:51.736Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A clean rex migrate --apply --dry-run does not mean apply would proceed: the write and read-back checks are skipped](./a-clean-rex-migrate-apply-dry-run-does.md) | pending |
| [A dissolved container's blockedBy rewrite at migrate --apply is invisible to a reviewer: neither the plan nor the dry run shows it](./a-dissolved-container-s-blockedby.md) | pending |
| [A leftover .rex/prd.json is auto-migrated back into prd_tree/ beside the v2 tree after rex migrate --apply](./a-leftover-rex-prd-json-is-auto.md) | pending |
| [After rex migrate --apply, an item blockedBy a dissolved release or review epic is blocked forever](./after-rex-migrate-apply-an-item.md) | completed |
| [Apply an approved plan in one transaction, re-runnable against a newer tree](./apply-an-approved-plan-in-one.md) | completed |
| [Applying a migration plan does not refuse one whose model pass is marked incomplete](./applying-a-migration-plan-does-not.md) | completed |
| [Chain layout and schema steps in ndx migrate and refuse legacy projects](./chain-layout-and-schema-steps-in-ndx.md) | pending |
| [Convert stray v1 files and warn on unreachable apply commits](./convert-stray-v1-files-and-warn-on.md) | pending |
| [ndx migrate --apply --dry-run says what moves and what is dropped](./ndx-migrate-apply-dry-run-says-what.md) | completed |
| [ndx migrate --plan has no automated test of its spawn path](./ndx-migrate-plan-has-no-automated-test.md) | pending |
| [Remove the prd.md and prd.json read fallbacks and the old migrate commands](./remove-the-prd-md-and-prd-json-read.md) | pending |
| [The v2 writer silently drops a folder's top-level state.yaml keys when the folder loses its last child](./the-v2-writer-silently-drops-a-folder.md) | completed |
| [Wire ndx migrate --plan to write the classified plan](./wire-ndx-migrate-plan-to-write-the.md) | completed |
| [Write Inbox changes to the reserved changes/inbox/ folder, and move them out on placement](./write-inbox-changes-to-the-reserved.md) | completed |
