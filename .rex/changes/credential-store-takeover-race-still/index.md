---
id: "67b9df15-34b2-42a5-a8b6-614ce1f249d7"
type: "change"
title: "Credential store takeover race still flakes on Windows CI: writers time out on the lock"
slug: "credential-store-takeover-race-still"
summary: "A Windows CI test of saved credentials still fails now and then, blocking unrelated pull requests until someone re-runs it."
intent: "Follow-up to change 8dd961e5 (issue #999, completed 2026-11-06), which made Windows lock-family EPERM/EBUSY transient. The same e2e test still fails intermittently on the Windows root+llm-client job, with a different failure: packages/llm-client/tests/e2e/credential-store-writers.test.ts > \"writers racing to take over a dead holder's lock lose no update\". Seen on main (CI run 42866370446, 2026-11-10) and on PR #1021 (run 43072557249, job 130704505566, 2026-11-11), which does not touch llm-client. In run-5 of the test, 9 of 10 writers exited 1 with \"Timed out waiting for the credential store lock …credentials.json.lock\": some still saw the dead holder (PID 676, since 2026-01-01), so the stale takeover never happened for them; others saw a live holder (PID 5900, since 18:12:28) that kept the lock past their 10 s wait. Hypotheses to check: the takeover guard (.takeover) left behind or never reclaimed, so no other writer can take over; the winner's release failing silently on a delete-pending lock, so the lock outlives its holder; Windows PID reuse making a finished holder read as alive; or the 10 s budget being too tight for ten processes on a loaded Windows runner."
acceptanceCriteria:
  - "The takeover test passes in 50 consecutive Windows runs (or a stress loop that reproduces today's timeout no longer does)"
  - "When one writer's lock outlives it, the remaining writers take it over within the wait budget instead of timing out (unit test with injected release failure)"
  - "The root cause is named in the change's history, and tests/e2e/credential-store-writers.test.ts is unchanged unless the budget itself was the cause"
touches:
  - "a63d1345-5167-4332-844a-0398aea517b1"
priority: "high"
source: "ndx-capture"
---
