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
| [A clean rex migrate --apply --dry-run does not mean apply would proceed: the write and read-back checks are skipped](./a-clean-rex-migrate-apply-dry-run-does.md) | completed |
| [A dissolved container's blockedBy rewrite at migrate --apply is invisible to a reviewer: neither the plan nor the dry run shows it](./a-dissolved-container-s-blockedby.md) | pending |
| [A failed prd_tree/ removal after the switch says the v2 tree is in place and to re-run apply](./a-failed-prd-tree-removal-after-the.md) | pending |
| [A leftover .rex/prd.json is auto-migrated back into prd_tree/ beside the v2 tree after rex migrate --apply](./a-leftover-rex-prd-json-is-auto.md) | completed |
| [After rex migrate --apply, an item blockedBy a dissolved release or review epic is blocked forever](./after-rex-migrate-apply-an-item.md) | completed |
| [Apply an approved plan in one transaction, re-runnable against a newer tree](./apply-an-approved-plan-in-one.md) | completed |
| [Apply on an already-v2 tree removes a leftover prd_tree/ only when it matches the plan](./apply-on-an-already-v2-tree-removes-a.md) | pending |
| [Apply rewrites v1 blockedBy refs to and from capabilities onto their open changes](./apply-rewrites-v1-blockedby-refs-to.md) | pending |
| [Apply's id check is pinned by a test, and the dry run reports v2 rule errors by rule](./apply-s-id-check-is-pinned-by-a-test.md) | pending |
| [Applying a migration plan does not refuse one whose model pass is marked incomplete](./applying-a-migration-plan-does-not.md) | completed |
| [Chain layout and schema steps in ndx migrate and refuse legacy projects](./chain-layout-and-schema-steps-in-ndx.md) | pending |
| [Convert stray v1 files and warn on unreachable apply commits](./convert-stray-v1-files-and-warn-on.md) | pending |
| [Dissolved containers keep their description, criteria and blockedBy](./dissolved-containers-keep-their.md) | pending |
| [Migrated product nodes read met when their v1 item completed](./migrated-product-nodes-read-met-when.md) | completed |
| [Migration plan, dry run and apply refuse when the v1 parser skipped an item file](./migration-plan-dry-run-and-apply.md) | pending |
| [ndx migrate --apply --dry-run says what moves and what is dropped](./ndx-migrate-apply-dry-run-says-what.md) | completed |
| [ndx migrate --plan has no automated test of its spawn path](./ndx-migrate-plan-has-no-automated-test.md) | completed |
| [Placement reads code evidence: commits and zones of a held change rank the capabilities realized in the same zones](./placement-reads-code-evidence-commits.md) | pending |
| [Remove the prd.md and prd.json read fallbacks and the old migrate commands](./remove-the-prd-md-and-prd-json-read.md) | pending |
| [rex health warns, not errors, on completed changes the migration held for placement](./rex-health-warns-not-errors-on.md) | pending |
| [tests/e2e/cli-migrate-apply.test.js fails 3 of 5: its fixture keeps .rex/prd.json, which apply now refuses](./tests-e2e-cli-migrate-apply-test-js.md) | completed |
| [The interrupted-apply test compares normalised snapshot paths, so Windows CLI smoke passes](./the-interrupted-apply-test-compares.md) | pending |
| [The v2 writer silently drops a folder's top-level state.yaml keys when the folder loses its last child](./the-v2-writer-silently-drops-a-folder.md) | completed |
