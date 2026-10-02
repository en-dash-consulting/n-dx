---
id: "57f63f2d-73c2-4f65-8906-dbedd3244544"
level: "task"
title: "Keep llm.<vendor>.reviewModel and llm.reviewModel in the loaded LLM config"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "llm-client"
  - "hench"
  - "bug"
source: "ndx work --resolve implementation (task 3e07628e)"
acceptanceCriteria:
  - "loadLLMConfig keeps llm.claude.reviewModel, llm.codex.reviewModel (normalized), llm.google.reviewModel and top-level llm.reviewModel"
  - "resolveClaudeConfig resolves reviewModel per field like the other Claude fields, and the dashboard's config endpoints see it"
  - "An `ndx work --resolve --review` test reports source llm.claude.reviewModel and llm.reviewModel for a fixture that sets each"
  - "A patch changeset covers @n-dx/llm-client"
description: "`hench run --help` and resolveReviewModel (packages/llm-client/src/config.ts) document the reviewer model precedence as --review-model > llm.<vendor>.reviewModel > llm.reviewModel > vendor default. But loadLLMConfig's whitelisting extractors in packages/llm-client/src/llm-config.ts drop `reviewModel` from the claude, codex and google blocks (CLAUDE_FIELDS / extractClaudeConfig, extractCodexConfig, extractGoogleConfig), and never copy the top-level `llm.reviewModel` either. Only `llm.local.reviewModel` survives. So a configured reviewer model is silently ignored for claude, codex and google, and `ndx work --resolve` correctly reports `vendor-default` for it. Found while writing packages/hench/tests/integration/run-resolve.test.ts, which uses llm.local.reviewModel because it is the only one that loads."
lastModified: "2026-10-02T05:42:55.433Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
