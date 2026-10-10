---
id: "d2d48473-3e07-4ec5-b167-6ba0bd370be2"
level: "task"
title: "Add hench.review.mode, hench.review.vendor and hench.review.rounds as project settings for the review pass"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-3"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "`ndx config hench.review.mode pair`, `hench.review.vendor codex` and `hench.review.rounds 3` are accepted; `hench.review.rounds 4`, `hench.review.mode sometimes` and `hench.review.vendor google` are rejected with a message."
  - "With `hench.review.mode self` and no flags, `ndx work` runs the review pass exactly as `--review` does; `--no-review` still suppresses it."
  - "With `hench.review.mode pair` before pair review exists, the run does not review and prints that pair review is not available yet."
  - "`ndx work --resolve` reports the three settings and their sources."
  - "`pnpm --filter @n-dx/hench test` and the package typecheck pass."
  - "`pnpm --filter @n-dx/core test` passes."
description: "Add a `review` block to hench's config schema (`packages/hench/src/schema/v1.ts`) and to `ndx config` validation (`packages/core/config.js`):\n\n- `hench.review.mode`: `\"off\" | \"self\" | \"pair\"`, default `\"off\"`.\n- `hench.review.vendor`: `\"claude\" | \"codex\"`, the reviewer for pair mode. Unset means the other one of the two.\n- `hench.review.rounds`: integer 1-3, default 2. How many times the executor may fix must-fix findings in pair mode.\n\nThe reviewer's model stays where it is today: `llm.<vendor>.reviewModel`, then `llm.reviewModel`, then the vendor default.\n\nWire the mode into hench's run-setting resolution (`packages/hench/src/cli/commands/run-settings.ts`, `run-resolve.ts`) at the `hench.*` rung: `--review` / `--no-review` and a task's saved `run.review` still win. `self` behaves exactly like today's `--review`. Until pair review exists (PRs 7-8), `pair` runs no review and prints one line saying pair review is not available yet: it must never silently fall back to self review. Review requires the CLI provider today (`reviewProviderError`); keep that refusal, and add one for pair mode when the reviewer is the executor's own vendor or is not claude/codex.\n\n`ndx work --resolve` shows `review.mode`, `review.vendor` and `review.rounds` with the key that supplied each. If the hench key inventory test requires every `ndx config` key on the Workflow page, either list these there or add them to its documented exemptions with a pointer to Robot Wrangler, which owns them."
lastModified: "2026-10-10T23:40:12.515Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
