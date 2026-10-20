---
id: "4a1a2c31-7f1c-49fc-bfd8-2c8355893b53"
level: "task"
title: "Move the IaC resource-kind table into lang-kit as data"
status: "completed"
priority: "high"
tags:
  - "language-packs"
  - "lang-kit"
  - "infrastructure"
  - "pr-11"
blockedBy:
  - "b4bb436a-120a-47c0-b217-ecffb3a027a1"
source: "roadmap"
startedAt: "2026-10-13T04:02:33.627Z"
completedAt: "2026-10-13T04:17:22.263Z"
endedAt: "2026-10-13T04:17:22.263Z"
resolutionType: "code-change"
resolutionDetail: "Run 2fdcaed2 committed 89c084229 + 6d67eea51; operator regenerated the iso-map skill script (expected drift). Output byte-identical; affected gate 5/5."
acceptanceCriteria:
  - "`grep -n \"const IAC_KINDS\" packages/sourcevision/src/analyzers/infrastructure.ts` finds nothing and infrastructure.ts imports IAC_KINDS from \"@n-dx/lang-kit\""
  - "`git diff HEAD~1 -- packages/sourcevision/src/analyzers/infrastructure.ts` shows only the import and the removed table with its comment"
  - "A lang-kit test pins all nine entries' pattern source, flags and kind in order, and `cd packages/lang-kit && npx vitest run` passes"
  - "`cd packages/sourcevision && SV_REQUIRE_GRAMMARS=1 npx vitest run tests/integration/terraform-infrastructure-unchanged.test.ts tests/unit/analyzers/infrastructure.test.ts tests/unit/analyzers/workspace-crossing-sources.test.ts` passes with those files unedited"
  - "scripts/build-iso-skill.mjs aliases @n-dx/lang-kit to the single source module, and nothing under .claude/ is changed by the run"
  - "The root policy suites in the feature description pass, except iso-skill-drift, which the operator closes by regenerating the skill script"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Decision 4 with Sterling H (he reviews this change): the IaC resource-kind table `IAC_KINDS` in packages/sourcevision/src/analyzers/infrastructure.ts becomes exported data in @n-dx/lang-kit, and infrastructure.ts reads it from there. Same patterns, same flags, same order, same results.\n\nDo:\n- Add a lang-kit module (for example packages/lang-kit/src/iac-kinds.ts) exporting the table, with the doc comment that explains it (one table for every dialect, Terraform's underscore form, `classifyResource` normalizes `AWS::SQS::Queue` to `aws_sqs_queue`). Keep the `[RegExp, kind]` entry shape; type it readonly (`ReadonlyArray<readonly [RegExp, string]>`) so no caller can reorder or mutate it. Export it from lang-kit's barrel.\n- In infrastructure.ts: delete the local table and import it from `@n-dx/lang-kit`. No other change to infrastructure.ts: `classifyResource`, the dialect parsers, the matching and the output stay as they are. `git diff` on that file shows only the import line and the removed table (and its comment).\n- A lang-kit unit test pins the table: every entry's `pattern.source`, `pattern.flags` and kind, in order, equal to today's nine entries.\n\nThe iso-map skill script bundles infrastructure.ts (scripts/build-iso-skill.mjs → .claude/skills/iso-map/scripts/iso-map.mjs), so it will now bundle lang-kit too:\n- In scripts/build-iso-skill.mjs add an alias for `@n-dx/lang-kit` to the one source module the bundle uses (packages/lang-kit/src/iac-kinds.ts), the same way it aliases @n-dx/llm-client to git-remote-url.ts, with a comment saying why (the bundle must not pull the rest of lang-kit, and it must not depend on lang-kit's dist being built).\n- Do not regenerate or edit anything under .claude/ (an agent cannot write there). tests/e2e/iso-skill-drift.test.js is expected to fail until the operator regenerates the script; say so in the run summary with the output of `node scripts/build-iso-skill.mjs --check`. Every other gate must pass.\n\nByte-identity: infrastructure.json and zones.json must not change on the Terraform and workspace-crossing fixtures (tests/integration/terraform-infrastructure-unchanged.test.ts, tests/unit/analyzers/infrastructure.test.ts, tests/unit/analyzers/workspace-crossing-sources.test.ts and tests/fixtures/workspace-crossings). These tests pass unedited."
lastModified: "2026-10-13T04:17:22.557Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
