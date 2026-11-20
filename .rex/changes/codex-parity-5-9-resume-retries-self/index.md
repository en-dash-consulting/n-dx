---
id: "a1e20ed5-e3cd-489e-8978-5bd2f46a52ea"
type: "change"
title: "Codex parity 5/9: resume retries, self-review and unfinished sessions"
slug: "codex-parity-5-9-resume-retries-self"
intent: "Approved by Ryan on 2026-11-11 from the read-only Codex parity/model-freshness audit of nine-PR stack tip PR #1016, commit 1316e0bf157fea68902d327ba9bdc1fdafe04214 (audit verification date 2026-11-09). Capture only now; no implementation, PR creation, merge, publication or restack is authorized by this capture. Future delivery: one PRD-only root PR followed by nine implementation PRs, one per numbered change; smaller tasks execute individually through ndx work. The current codex/pr-stack-review-remediation branch contains PRD coordination metadata and lacks the reviewed stack's code: never use it as the implementation baseline. The future root must be based on main containing the prerequisite stack/fixes, or an explicitly coordinated descendant of the verified stack tip. Preserve existing dirty work. Existing finding 8 (8db45797-fb8f-47e6-a28f-4df3b247b1c5, configured binary selection) then finding 2 (2337bb92-a7bc-4e91-a886-e727b1a182a3, broker approvals) remain separate owning-stack prerequisites, not new parity implementation PRs. Use Codex CLI and Codex self-review; do not silently fall back to Claude. Each task needs scoped validation, required root checks and scoped patch changesets, with atomic code/PRD commits and final N-DX-Item trailers. Separate actual installed-CLI observations from fake binaries/mocked argv; report unsupported/unavailable versions and untested browser flows explicitly. Use disposable fixtures outside production task data; never expose credentials. Reverify current official OpenAI guidance and the effective installed binary/model availability during implementation; public documentation is not proof of account access.\n\nPlanned implementation PR 5 of 9 (stack position 6 of 10).\n\nRoadmap 6b and 6c. Audit sources: hench/cli-loop.ts:416 and :1849 restrict retry/self-review resume to Claude; adapters/codex-cli-adapter.ts:49 disables unfinished-session recovery. Codex batch continuation and pair repair already resume and must not be reimplemented. Preserve separate bounded recovery cases."
acceptanceCriteria:
  - "Reuse Codex sessions for transient retries and self-review: Correct Codex work session resumes for a transient retry and for self-review instead of a fresh context-only spawn."
  - "Reuse Codex sessions for transient retries and self-review: Worktree, branch, model and execution-policy identity changes invalidate reuse; every resumed spawn reapplies current policy and credential isolation."
  - "Reuse Codex sessions for transient retries and self-review: Bounded fallback avoids replaying completed work or recursively resuming a failed resume; retry budgets and review gates remain effective."
  - "Reuse Codex sessions for transient retries and self-review: Tests establish both argv and session continuity on a supported real CLI, reporting untested versions separately."
  - "Recover Codex work or review sessions that ended unfinished: Supported unfinished-work/review signals receive one bounded continuation of the correct session."
  - "Recover Codex work or review sessions that ended unfinished: Missing review reports cannot masquerade as successful review; failed continuation yields an actionable failure."
  - "Recover Codex work or review sessions that ended unfinished: Recovery never repeats already completed task mutations or commits, widens policy or bypasses the test/review gate."
  - "Recover Codex work or review sessions that ended unfinished: Cover work, reviewer, interruption/cancellation and repeat-wait failure cases with disposable fixtures and supported-CLI evidence."
  - "All child tasks pass scoped validation and required checks with scoped patch changesets; real CLI/browser evidence is distinguished from mocks and preserves intentional user pins and credential boundaries."
touches:
  - "7dcba8e2-05e4-42bd-9172-4e146c692916"
  - "6eb227af-ffb2-4f39-8f62-d4afbad09a57"
  - "3415b5f0-3496-4813-8cc9-9f571044d49c"
priority: "medium"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-5"
  - "stack-position-6-of-10"
source: "ndx-capture"
blockedBy:
  - "12757fc1-b8c4-4708-945a-069398d311f7"
---
