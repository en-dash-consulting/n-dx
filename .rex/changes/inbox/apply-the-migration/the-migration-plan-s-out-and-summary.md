---
id: "04fec431-6040-44fc-8817-3a7c345fc646"
type: "task"
title: "The migration plan's --out and --summary guard compares real paths and refuses n-dx state directories"
slug: "the-migration-plan-s-out-and-summary"
description: "Ported from the 2026-10-12 review of #688 (local C1 task 106856d2, fixed there but never pushed); the defect is still in #715. packages/rex/src/cli/commands/migrate-plan.ts:171-172 guard --out and --summary with assertOutsideRexDir (packages/rex/src/cli/commands/export.ts:154), which uses path.relative with no realpath, and only against the current rexDir.\n\nFailure scenarios: (a) --out=<proj>/.REX/plan.json on case-insensitive APFS, (b) a symlink to .rex, (c) a /tmp versus /private/tmp alias all write into the real .rex/ with exit 0; (d) on a legacy-layout project --out=.ndx/plan.json passes and mkdir(dirname(outPath)) at migrate-plan.ts:196 creates .ndx/, which flips layout detection (llm-client layout.ts detectLayoutMode is isDirectory(<root>/.ndx)): afterwards rex status and ndx status fail and a hint to run ndx init would scaffold an empty PRD at .ndx/rex.\n\nFix (as C1 did): compare the realpath of the nearest existing ancestor of the output path with the realpath of each guarded directory, case-folded on darwin/win32, and refuse any path under the project's n-dx state, taking the directory names from the resolver (layoutStateNames().dirNames from @n-dx/llm-client), never literals (layout-literal-policy). Shared with rex export. Check before mkdir. Keep it minimal."
acceptanceCriteria:
  - "--out with a case variant of the rex directory is refused on a case-insensitive filesystem (test)"
  - "--out through a symlink to the rex directory, and a /tmp alias of it, are refused (tests)"
  - "--out=.ndx/plan.json on a legacy-layout project is refused and creates no .ndx/ (test)"
  - "--summary is held to the same guard; rex export refuses the same paths (tests)"
  - "layout-literal-policy passes"
priority: "medium"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
source: "review-2026-10-12"
---
