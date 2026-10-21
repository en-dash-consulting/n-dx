---
id: "a630d87a-41db-45bf-9547-7077289a6a8b"
level: "task"
title: "ndx migrate --plan shows the preflight banner and an honest run summary, and llm.routes can turn Jev off"
status: "completed"
priority: "medium"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
blockedBy:
  - "1aba5faa-aa60-4566-a045-928ab6c61795"
source: "review-2026-10-12"
startedAt: "2026-10-16T03:21:46.670Z"
completedAt: "2026-10-16T04:06:21.148Z"
endedAt: "2026-10-16T04:06:21.148Z"
acceptanceCriteria:
  - "ndx migrate --plan prints the preflight banner on a TTY and not under --yes or non-TTY (test)"
  - "With TYPESAFE_API_KEY set and llm.routes['*'] or llm.routes['prd.migrate.judge'] set to a tier, migrate-plan runs no Jev pass (test)"
  - "After a banner-shown plan run that used models, the summary does not say 'no model calls' or 'nothing spent' and lists the --out path as written; --rules-only still reports no model calls (tests)"
  - "docs/cli-ui-gap.md is regenerated and cli-ui-gap-drift passes"
description: "Ported from the 2026-10-12 review of #688 (local C1 tasks 259bd12c and df8ae206, fixed there but never pushed); still present in #715, minus the Jev flag (#715 has --no-jev-review).\n\n1. No preflight banner: packages/core/cli.js handleMigrate (around line 1829) does not use withPreflight, though COMMAND_EFFECTS.migrate declares three model phases. On this repository the default plan run is hundreds of text calls plus a Jev call per judged item, and it starts with no banner and no Ctrl-C pause.\n2. Jev runs whenever TYPESAFE_API_KEY is exported (packages/rex/src/cli/commands/migrate-plan.ts:129-130). The project-level opt-out, an llm.routes tier for prd.migrate.judge or '*' (llm-client resolveJudgmentRoute), is not consulted, while llm-client config.ts:535-537 calls prd.migrate.judge opt-in.\n3. Once the banner is on, the run summary withPreflight prints after the run (packages/core/run-summary.js) counts usage only from analyze and sourcevision, so it would say 'no model calls — nothing spent' after a run that made hundreds, and the --out path is not listed as written.\n\nFix, minimal (decided 2026-10-12, S2-Q3 and S2-Q4): wrap the --plan spawn in withPreflight (strip --yes as plan/analyze do); Jev runs only with a key, without --no-jev-review, and when llm.routes sends no tier to prd.migrate.judge (exact or glob, as resolveJudgmentRoute matches); migrate declares its model usage as untracked so the summary says the calls are not counted, and the declared write follows --out. No token accounting. Regenerate docs/cli-ui-gap.md."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T04:06:21.456Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
