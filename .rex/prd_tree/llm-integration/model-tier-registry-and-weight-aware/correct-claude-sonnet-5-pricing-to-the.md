---
id: "4cd36470-40d7-4bec-bd21-f3fe6ecb62c1"
level: "task"
title: "Correct claude-sonnet-5 pricing to the now-standard 2/10 per MTok rate"
status: "completed"
priority: "medium"
startedAt: "2026-10-02T05:23:26.659Z"
completedAt: "2026-10-02T05:36:02.527Z"
endedAt: "2026-10-02T05:36:02.527Z"
resolutionType: "code-change"
resolutionDetail: "MODEL_COSTS claude-sonnet-5 set to 2/10/2.50/0.20 (verified against pricing page 2026-10-02); header comment fixed; tests updated; changeset added."
acceptanceCriteria: []
description: "Found reviewing the 5.5 model-list hotfix (2026-10-02). Severity: medium. Every historical claude-sonnet-5 run is over-reported by 50% in `ndx usage`, budget preflight and the dashboard spend views.\n\nFAILURE SCENARIO\nMODEL_COSTS[\"claude-sonnet-5\"] in packages/llm-client/src/config.ts is input 3.00 / output 15.00 / cache write 3.75 / cache read 0.30. The Anthropic pricing page (https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-10-02) now says the $2/$10 launch price \"is now the standard price\" and that the scheduled 1 Sep 2026 rise to $3/$15 \"will not occur\". A run recorded as claude-sonnet-5 with 1M input + 1M output tokens shows $18.00; the real cost is $12.00.\n\nSOLUTION\n- Set MODEL_COSTS[\"claude-sonnet-5\"] to inputPerMToken 2.00, outputPerMToken 10.00, cacheWritePerMToken 2.50, cacheReadPerMToken 0.20. Write the values literally, as the table's header comment requires.\n- The MODEL_COSTS header comment says \"Gemini Pro and Claude Sonnet 5 have tiered/introductory rates; the values here are the standard (higher) tier\". Drop the Sonnet 5 part and keep the Gemini Pro part.\n- Re-verify the claude-sonnet-5 row against the pricing page before committing. If the page no longer says $2/$10, stop and report rather than guessing.\n- Update tests that assert the old claude-sonnet-5 figures. Do not touch fixtures that only use the id as sample data.\n\nOUT OF SCOPE: docs/analysis/**, CHANGELOG.md files, every other MODEL_COSTS row.\n\nACCEPTANCE CRITERIA\n- resolveModelPricing(\"claude-sonnet-5\") returns 2.00 / 10.00 / 2.50 / 0.20, and known: true.\n- No comment in packages/llm-client/src still says Sonnet 5 has an introductory or tiered rate.\n- The pricing parity tests pass: tests/unit/token-pricing-parity.test.js and packages/web/tests/unit/server/token-usage-per-model-parity.test.ts.\n- A changeset bumps @n-dx/llm-client at patch.\n- pnpm build and pnpm test pass from the repo root."
lastModified: "2026-10-02T05:36:02.927Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
