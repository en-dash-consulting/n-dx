---
id: "7d0695e3-3ba0-43f5-9662-08b766f66f07"
level: "task"
title: "Wire the migrate chain and the once-per-command v1 notice onto main's ndx migrate"
status: "pending"
priority: "critical"
tags:
  - "pr-23"
  - "lane-migration"
  - "restack-2026-10-14"
source: "restack-2026-10-14"
acceptanceCriteria:
  - "Bare ndx migrate on a legacy-layout v1 fixture runs layout, then plan (rex migrate-plan) and apply (rex migrate-apply), and a re-run reports every link already done (e2e)"
  - "ndx migrate --plan and ndx migrate --apply behave as on layer 1 (existing tests pass)"
  - "ndx status and ndx ci on a v1 project print the deprecation notice exactly once (tests/e2e/cli-legacy-notice-once.test.js)"
  - "tests/unit/migrate-chain.test.js, packages/rex/tests/e2e/cli-legacy-layout-notice.test.ts, tests/e2e/cli-migrate-apply.test.js and the v2 isolation test pass"
  - "docs/cli-ui-gap.md regenerated; the six root policy tests and cli-spawn-boundary pass"
description: "Restack of the closed stack 2 onto main (2026-10-14), layer 2. The chain and the v1 notice are cherry-picked from feat/100-pr23c-migrate-chain (ad842166 b01e74faa + ffcfc1d59, 58f8f7b9 5e54fd022; both completed there): packages/core/migrate-chain.js, tests/unit/migrate-chain.test.js, packages/rex/src/cli/legacy-layout-notice.ts (called from packages/rex/src/cli/index.ts) and its e2e test came across. Every hunk in packages/core/cli.js, help.js, command-effects.js, docs/guide/commands.md, docs/cli-ui-gap.md, the v2 isolation allowlist and tests/e2e/cli-migrate-apply.test.js was dropped, because main's handleMigrate is Hal's #715 version (plus layer 1's --apply). So today the chain module is unused and core prints no notice.\n\nWire them onto main:\n- packages/core/cli.js handleMigrate: bare `ndx migrate [dir]` (neither --plan nor --apply) runs runMigrateChain from ./migrate-chain.js with migrateLayout = runMigrateLayout, as b01e74faa did (git show b01e74faa -- packages/core/cli.js). --plan and --apply keep layer 1's behaviour.\n- packages/core/migrate-chain.js: its schema-v2 link spawns `rex migrate --plan` then `rex migrate --apply`; on main these are `rex migrate-plan --out=<path>` (path required; use ./migration-plan.json, the same default ndx migrate --plan uses) and `rex migrate-apply --plan=<path> [--dry-run]`. Keep its flag picking (PLAN_FLAGS) in line with migrate-plan's flags (--rules-only, --no-jev-review, --model, --cut-at, --out).\n- The once-per-command notice from 5e54fd022: LEGACY_NOTICE_COMMANDS, LEGACY_LAYOUT_NOTICE and noteLegacyLayoutOnce in packages/core/cli.js, called where 5e54fd022 called it, and the migrate-chain.js change it made (git show 5e54fd022). tests/e2e/cli-legacy-notice-once.test.js came across with the pick.\n- Add packages/rex/src/cli/legacy-layout-notice.ts to the v2 isolation allowlist in packages/rex/tests/unit/schema/v2.test.ts if it imports a v2 module (it imports PRODUCT_DIRNAME from store/prd-model-reader.js).\n- Re-add the chain e2e cases b01e74faa added to tests/e2e/cli-migrate-apply.test.js, adapted to the #715 default plan path.\n- packages/core/help.js, command-effects.js (the bare chain: layout move and commit, plan file, v2 tree), docs/guide/commands.md, README.md; regenerate docs/cli-ui-gap.md with node scripts/build-cli-ui-gap.mjs.\n\nOut of scope here (captured separately): the notice tests' environment (6ffeb488), self-heal/start/web and the agent-run refusal (315b10e0, folds bf27fa7e), the chain's banner and rules-only dry run (2ba1d161), ndx init scaffolding v2 (ff12092b, its own PR). Keep it minimal: wiring only."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T04:02:48.522Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
