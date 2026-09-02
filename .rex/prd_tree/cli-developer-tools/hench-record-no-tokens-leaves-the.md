---
id: "90e6afb9-a3ab-49e4-bea5-bcca4c5b28e4"
level: "task"
title: "`hench record --no-tokens` leaves the session watermark behind, so the suppressed spend lands on the next record"
status: "completed"
priority: "medium"
tags:
  - "hench"
  - "token-usage"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
startedAt: "2026-08-25T20:21:14.059Z"
completedAt: "2026-08-25T20:28:28.654Z"
endedAt: "2026-08-25T20:28:28.654Z"
acceptanceCriteria:
  - "Given a transcript with spend accrued before task A's record, `hench record --task=A --no-tokens` followed by `hench record --task=B` in the same session yields a B record whose tokenUsage does not include that spend"
  - "A unit test in `packages/hench/tests/unit/cli/record.test.ts` pins the chosen semantics with the two-record sequence above — it fails today and passes once fixed"
  - "`hench record --help` states what happens to spend suppressed by `--no-tokens`"
description: "**Severity:** medium — **Verdict:** should-fix (captured from /ndx-adversarial-review of branch chore/pr-329-review-followups)\n\n**Failure scenario.** In one Claude Code session: task A spends 100k output tokens, then `hench record --task=A --no-tokens` is run; task B follows and is recorded normally with `hench record --task=B`. B's record — and B's PRD-item rollup via `get_token_usage` and `ndx usage` — silently includes A's 100k tokens. The `--no-tokens` branch in `packages/hench/src/cli/commands/record.ts:171` returns before the transcript is read or the cursor saved, so the session watermark never advances past A's spend and the next record claims it.\n\n**Refutation attempted.** Looked for a cursor advance in the disabled branch (none), for stated semantics in the changeset (\".changeset/assisted-runs-record-token-usage.md\" says only \"--no-tokens opts out\"), in `hench record --help` (\"Record without token usage\" — silent on where the spend goes), and in tests (the `--no-tokens` case in packages/hench/tests/unit/cli/record.test.ts checks only the record itself, not what the next record claims). The code is also internally inconsistent: the explicit-flags path advances the watermark with the rationale \"that spend is now accounted for\", and `--no-tokens` COMBINED with explicit token flags does advance it (the early return requires no explicit usage) — while `--no-tokens` alone does not.\n\n**Reachability.** Any use of the documented `--no-tokens` flag followed by another record in the same session. Skill flows do not pass it by default, so this is an edge path — but it is the flag's advertised use.\n\n**Decision to make (burn vs defer).** Should spend suppressed by `--no-tokens` be attributed to nothing (burned), or roll into the next record (deferred)? The review recommends burn: it matches the flag's plain reading, the explicit-flags precedent, and the module's goal of honest attribution.\n\n**Possible solutions.**\n1. *Recommended (burn).* In `resolveUsage`, still read the transcript and advance the watermark when `--no-tokens` is set, discarding the numbers — mirroring what already happens when `--no-tokens` is combined with explicit flags. Small branch change plus a two-record unit test. Risk: minimal; changes behavior only for the sequence described.\n2. *(Defer, documented.)* Keep the current behavior and state in `hench record --help` and the changeset that suppressed spend rolls into the session's next record. Zero code risk, but the semantics stay surprising and inconsistent with the flags path."
---
