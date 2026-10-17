---
id: "e105ad53-3d4a-4579-8bae-a1307cf0071b"
level: "task"
title: "Guard CI's grammar steps with a test and cover every group that runs a pack suite"
status: "pending"
priority: "high"
tags:
  - "review-fixes"
  - "ci"
  - "test-coverage"
  - "pr-20"
source: "review"
acceptanceCriteria:
  - "Every CI test leg whose suites include sourcevision or a grammar-carrying lang-* pack builds grammars and sets SV_REQUIRE_GRAMMARS=1 before running them"
  - "A root e2e test reads ci.yml and fails when any such leg lacks the steps, has them after the run step, or has them in another job"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Change .github/workflows/ci.yml and add a root e2e test only. The session runs full CI (ci:run) on the stack top afterwards to confirm the grammar tests execute."}
description: "Two related CI items.\n\n1. **Coverage gap (session note, PR 12a).** In .github/workflows/ci.yml the test job's grammar steps (\"Cache grammar build downloads\", \"Build tree-sitter grammars\", \"Require built grammars in tests\") are gated on `contains(matrix.suites, 'sourcevision')`. From 12a on, though, the packs' own suites (lang-runtime, lang-java, lang-go, lang-sql, lang-terraform, lang-python) run in the root group (`root,llm-client,lang-kit,…`). On that leg no grammar is built and SV_REQUIRE_GRAMMARS is not set, so every pack golden and query test silently skips in CI. Fix: gate the steps on every matrix group whose suites include sourcevision or any lang-* pack that has grammars. Prefer deriving that from one list, and keep the cache key and build command as they are.\n\n2. **No guard (review of b6ca93d3, finding 857a8c79).** Any of these future ci.yml edits would silently send every skipUnlessGrammar test back to skipping, while CI stays green:\n   - moving the steps to another job (the original #762 defect);\n   - moving a suite into a different group, or renaming the label;\n   - reordering the steps after the \"Run\" step.\n\n   Add a root e2e test in the style of tests/e2e/ci-merge-queue-trigger.test.js that reads ci.yml. For every step running scripts/run-all-tests.mjs, the same job must contain the grammar build step and the SV_REQUIRE_GRAMMARS=1 export before it, with an `if:` true for every matrix combination whose suites include sourcevision or a grammar-carrying lang-* package. The test fails naming any combination that lacks them.\n\nThe session confirms with a real CI run that the grammar tests execute."
lastModified: "2026-10-17T09:21:39.188Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
