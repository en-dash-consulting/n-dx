---
id: "21c9901f-3b7d-4e60-a0d1-a32e1693ee07"
level: "task"
title: "Have the other vendor review the diff and write the findings report when the review pass runs in pair mode"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-7"
blockedBy:
  - "d2d48473-3e07-4ec5-b167-6ba0bd370be2"
  - "33f281fb-22ab-4f2f-bf3b-973f7dee61be"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "In pair mode with a claude executor, the review spawns the codex CLI fresh (not resumed) with the reviewer model, and the prompt forbids file edits (unit test with a stub CLI)."
  - "The reviewer's JSON report is parsed and recorded on the run record with mode pair, reviewer vendor and model."
  - "A missing reviewer CLI skips the review with a warning and does not fail the task."
  - "Self mode behaves exactly as before."
  - "`pnpm --filter @n-dx/hench test` and the package typecheck pass."
description: "In hench's review pass (`runAdversarialReviewPass` in `packages/hench/src/agent/lifecycle/cli-loop.ts`, with the pure half in `packages/hench/src/agent/analysis/adversarial-review.ts`), add the pair branch.\n\n**Which reviewer and model:** when the resolved mode is `pair`, spawn the reviewer vendor's CLI (`hench.review.vendor`, or the other of claude/codex) as a fresh session; it cannot resume another vendor's session. Use the reviewer model chain `llm.<reviewer>.reviewModel` → `llm.reviewModel` → vendor default.\n\n**Prompt:** build it from the task brief, `git diff <startCommit>`, and the changed-file list. Reuse the adversarial posture of `buildReviewSystemPrompt`, but tell the reviewer to **report only and edit no files**: fixing is the executor's job in pair mode.\n\n**Report:** the reviewer writes the existing JSON report to a file, parsed by the existing parser.\n\n**Environment:** spawn with the trusted-environment rules from PR 3.\n\n**Reviewer can't start:** if its CLI is missing or unauthenticated, skip with a warning under the existing `reviewOptional` semantics.\n\n**Run record:** record the review with `mode: \"pair\"`, the reviewer vendor and model, and the finding counts.\n\nUntil the fix loop lands (next PR), capture all findings, must-fix included, to the PRD as today's capture path does, and do not block the commit."
lastModified: "2026-10-10T23:41:24.211Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
