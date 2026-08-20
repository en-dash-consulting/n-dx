---
id: "08ceeb30-fa7c-4450-aa43-9ae2b4479031"
level: "task"
title: "/ndx-adversarial-review records tokens without --startedAt, so the first record claims the whole session"
status: "pending"
priority: "high"
tags:
  - "skills"
  - "token-usage"
  - "severity:high"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Step 1 of the canonical skill body instructs capturing the current time in ISO-8601 before any other work"
  - "The instruction is platform-neutral — it does not prescribe `date -Is` or any other POSIX-only command"
  - "The final step's `ndx hench record` invocation passes `--startedAt=<captured time>`"
  - "Regenerated `.claude/` and `.agents/` copies match the canonical source (tests/e2e/assistant-body-drift.test.js green)"
description: "**Severity:** high — **Verdict:** must-fix\n\n**Failure scenario.** A user works for an hour, then invokes `/ndx-adversarial-review`. Its final step runs `ndx hench record --task=skill:ndx-adversarial-review` with no `--startedAt`. In `packages/hench/src/cli/commands/record.ts:208`, `readUsageDelta(transcript.text, cursor, flags.since || flags.startedAt)` receives `undefined`; with no watermark yet for the session, `startAt` falls to the top of the transcript and the review's record claims the entire session's spend, including work that had nothing to do with the review.\n\n**Evidence.** `packages/core/assistant-assets/skills/ndx-adversarial-review.md` — final step, item 2. The failure is documented in `packages/hench/src/store/session-usage.ts:99-112` with measured numbers: \"a first record in a long session claimed 549 messages and 127M cache-read tokens, four earlier tasks' spend included.\" `/ndx-work` solves this at its step 7 by noting the time before work begins; this skill dropped that pattern.\n\n**Reachability.** Every first invocation in a session — the normal case for a one-shot review. The session cursor bounds only *subsequent* records. Confirmed reachable in the session that produced this finding.\n\n**Possible solutions.**\n1. *Recommended.* Add a clause to Step 1 instructing the assistant to record the current time in ISO-8601 before any other work, and pass it as `--startedAt=<time>` in the final record step. Two clauses, no risk. Express it platform-neutrally — do NOT copy `/ndx-work`'s `date -Is`, which is a POSIX-ism that fails in PowerShell.\n2. Use the existing `--since` flag instead. Equivalent for the usage window, but `--startedAt` also sets the record's real start time, which the duration rollup in `get_token_usage` reads. Option 1 is strictly better."
---
