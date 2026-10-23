---
id: "5141fb6c-d0a0-4fe0-b90d-12ed9e9a951d"
type: "change"
title: "Autonomous runs finish their session"
slug: "autonomous-runs-finish-their-session"
intent: "hench's Foreground Invariant (`packages/hench/src/agent/planning/prompt.ts:162`, changeset `foreground-invariant-autonomous-runs.md`) is prompt text only. Nothing enforces it: `claude-cli-adapter.ts` builds an `--allowed-tools` allowlist, and Bash's `run_in_background` is a parameter of an allowed tool, so any `Bash(npm:*)` call can still background. In run 01d15d75 (task a0eaf286, Sonnet 5) the agent backgrounded the full suite, called ScheduleWakeup, and ended its turn waiting for a notification that never comes in a `claude -p` session. The uncommitted-work gate then refused completion and reset the task, though hench's own test gate had passed. The reviewer, which resumes a fork of the work session, inherited the wait, deferred writing its report, and the run showed \"NOT reviewed\".\n\nThis matters for the release, not only for convenience: WM2054's measurement batch runs hench on the published 0.7.1 build, so runs that end this way distort what it measures.\n\nApproach agreed 2026-09-24: detect and resume, following the existing `planModeIntercept` pattern in `cli-loop.ts` (a signal on the spawn result that the outer loop acts on). The session id is already captured (`sessionId` on the spawn result) and the adapter supports `--resume`. Build this interactively rather than through `ndx work`, since the defect is in the runner.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts); every user-facing change carries a patch changeset using the scoped package name; run pnpm preflight before opening the PR."
touches:
  - "9fe4e4e6-eb03-476f-9955-d0013a0c6c81"
plannedRelease: "0.7.1"
priority: "high"
tags:
  - "0.7.1"
  - "pr-bg"
  - "hench"
  - "run-lifecycle"
source: "PR M execution, 2026-09-24 (run 01d15d75)"
---
