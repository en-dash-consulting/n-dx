---
id: "11053432-d02e-48ad-bc85-f165168c6ba7"
level: "task"
title: "Migration plan checks slugs against v1 siblings, so items that become v2 siblings can share a slug and the writer refuses the tree"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lane-migration"
  - "rex"
blockedBy:
  - "eda7bfcb-1d92-419d-9882-79ac3eba99c4"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Two v1 features with the same title under different release epics get distinct v2 slugs in the plan, and are flagged (test)"
  - "Every slug the plan freezes is unique, ignoring case, within its v2 sibling set (test over a fixture with reparenting)"
  - "A tree built from the plan is accepted by writePrdModel (test)"
description: "Found by the adversarial review of task b32a3e6f. Verdict: out-of-scope. The plan never assigned slugs before, so this was not introduced by that change. Medium.\n\nScenario: classifyV1Tree reparents items. Release-umbrella children become root changes, features under PR epics become tasks, and deep items are flattened into subtasks of the nearest task. Two release epics \"ndx 0.9.0\" and \"ndx 0.10.0\" can each have a feature \"Docs\". Both have the v1 slug \"docs\", unique among their v1 siblings. In v2 both are root changes, and prd-model-writer.ts refuses the tree: \"Two nodes ... share the slug\". The new slug check in migration-plan-data.ts buildPlanData (resolveSiblingSlugs over the v1 sibling list) works only within v1 sibling sets. Its replacement (freeSlug with v1 siblings) has the same blind spot.\n\nReachability: not reachable until the migration apply (PR 23) writes the v2 tree.\n\nOptions: (a) recommended: resolve every frozen slug against its v2 sibling set, which comes from the plan's target parent and layer (product vs changes). On a case-insensitive clash, suffix the later items with -<id6>, flag them, and record the v1 name, as slug {from,to} already does. (b) Leave it to the apply step to detect and refuse. That is cheaper, but a person meets the clash only at apply time, not when reviewing the plan.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it (runs 699cd138 and the PR 17 store-transaction run failed only on that)."
lastModified: "2026-10-08T21:40:54.937Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
