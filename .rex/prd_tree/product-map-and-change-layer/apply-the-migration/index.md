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
| [A re-plan reuses the earlier plan's cut time only when the tree is unchanged](./a-re-plan-reuses-the-earlier-plan-s.md) | pending |
| [After rex migrate --apply, an item blockedBy a dissolved release or review epic is blocked forever](./after-rex-migrate-apply-an-item.md) | completed |
| [Agents in ndx work runs see "Run 'ndx migrate'" on every rex command and can run the migration unasked](./agents-in-ndx-work-runs-see-run-ndx.md) | pending |
| [Apply an approved plan in one transaction, re-runnable against a newer tree](./apply-an-approved-plan-in-one.md) | completed |
| [Apply on an already-v2 tree removes a leftover prd_tree/ only when it matches the plan](./apply-on-an-already-v2-tree-removes-a.md) | pending |
| [Apply rewrites v1 blockedBy refs to and from capabilities onto their open changes](./apply-rewrites-v1-blockedby-refs-to.md) | pending |
| [Apply's id check is pinned by a test, and the dry run reports v2 rule errors by rule](./apply-s-id-check-is-pinned-by-a-test.md) | pending |
| [Applying a migration plan does not refuse one whose model pass is marked incomplete](./applying-a-migration-plan-does-not.md) | completed |
| [Chain layout and schema steps in ndx migrate; v1 PRDs warn now and are refused one release later](./chain-layout-and-schema-steps-in-ndx.md) | completed |
| [Convert stray v1 files and warn on unreachable apply commits](./convert-stray-v1-files-and-warn-on.md) | pending |
| [Dissolved containers keep their description, criteria and blockedBy](./dissolved-containers-keep-their.md) | pending |
| [Migrated product nodes read met when their v1 item completed](./migrated-product-nodes-read-met-when.md) | completed |
| [Migration plan, dry run and apply refuse when the v1 parser skipped an item file](./migration-plan-dry-run-and-apply.md) | pending |
| [ndx commands that spawn rex several times print the v1 deprecation notice once per spawn](./ndx-commands-that-spawn-rex-several.md) | completed |
| [ndx init scaffolds a v2 project (product/index.md, never prd_tree/)](./ndx-init-scaffolds-a-v2-project.md) | pending |
| [ndx migrate --apply --dry-run says what moves and what is dropped](./ndx-migrate-apply-dry-run-says-what.md) | completed |
| [ndx migrate --plan has no automated test of its spawn path](./ndx-migrate-plan-has-no-automated-test.md) | completed |
| [ndx migrate --plan shows the preflight banner and an honest run summary, and llm.routes can turn Jev off](./ndx-migrate-plan-shows-the-preflight.md) | pending |
| [ndx self-heal, start and web silence the v1 notice for their children, and ndx migrate refuses inside an agent run](./ndx-self-heal-start-and-web-silence.md) | pending |
| [Placement reads code evidence: commits and zones of a held change rank the capabilities realized in the same zones](./placement-reads-code-evidence-commits.md) | pending |
| [Remove the prd.md and prd.json read fallbacks and the old migrate commands](./remove-the-prd-md-and-prd-json-read.md) | pending |
| [rex health warns, not errors, on completed changes the migration held for placement](./rex-health-warns-not-errors-on.md) | pending |
| [tests/e2e/cli-migrate-apply.test.js fails 3 of 5: its fixture keeps .rex/prd.json, which apply now refuses](./tests-e2e-cli-migrate-apply-test-js.md) | completed |
| [The bare ndx migrate chain shows the preflight banner and its --dry-run runs no model unless asked](./the-bare-ndx-migrate-chain-shows-the.md) | pending |
| [The interrupted-apply test compares normalised snapshot paths, so Windows CLI smoke passes](./the-interrupted-apply-test-compares.md) | pending |
| [The migration plan's --out and --summary guard compares real paths and refuses n-dx state directories](./the-migration-plan-s-out-and-summary.md) | pending |
| [The v1 notice tests strip NDX_LEGACY_NOTICE from the environment they spawn with](./the-v1-notice-tests-strip-ndx-legacy.md) | completed |
| [The v2 writer silently drops a folder's top-level state.yaml keys when the folder loses its last child](./the-v2-writer-silently-drops-a-folder.md) | completed |
| [Wire migrate apply onto #715's migrate-plan and #716's Inbox writer](./wire-migrate-apply-onto-715-s-migrate.md) | completed |
| [Wire the migrate chain and the once-per-command v1 notice onto main's ndx migrate](./wire-the-migrate-chain-and-the-once.md) | pending |
