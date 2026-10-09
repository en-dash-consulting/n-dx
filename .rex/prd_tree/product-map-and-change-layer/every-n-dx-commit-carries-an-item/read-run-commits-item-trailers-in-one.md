---
id: "d827e9f0-309d-4c6d-869f-0ea24091522d"
level: "task"
title: "Read run commits' item trailers in one git call and build only the brief each loop uses"
status: "completed"
priority: "low"
source: "review"
startedAt: "2026-10-09T05:37:49.878Z"
completedAt: "2026-10-09T14:46:05.686Z"
endedAt: "2026-10-09T14:46:05.686Z"
resolutionType: "code-change"
resolutionDetail: "Verified and closed by the operator. Run d78b4a4d-94c6-4f82-86f2-77eca1f8eac3 (claude-sonnet-5-5, review claude-opus-5-5) passed its test gate but failed because its own commit was refused: the agent cd'd into packages/hench/src/agent/lifecycle and never returned to the project root, and its git -C retry is forbidden. The operator committed the run's three paths as e79963031. After rebuilding hench: agent-commit-item-trailer, cli-loop and loop tests 12/12, six static root policy tests pass."
acceptanceCriteria:
  - "findCommitsMissingItem makes one git call per run, not one per commit, and its existing tests still pass (plus a test with several commits, one missing the trailer)"
  - "The API, Gemini and local loops no longer build a prompt envelope they discard; cli-loop still sends the brief with the commit trailers (existing agent-commit-item-trailer tests pass)"
description: "From Ryan's review of #619 (2026-10-09 05:04Z), two low findings. (1) findCommitsMissingItem in packages/hench/src/agent/lifecycle/shared.ts (~line 3558) runs one `git log -1` per commit, one after another, in finalizeRun; a single `git log --format=%H%x1f%(trailers:key=N-DX-Item,valueonly,separator=%x1e) <startHead>..HEAD` (or over the run's commit shas) returns every commit's items in one call. Keep the behaviour: read through git's trailer parser, record commits whose items do not include the task id, say nothing for a commit that cannot be read. (2) The API, Gemini and local loops in packages/hench/src/agent/lifecycle/loop.ts (lines ~768, ~1373, ~1923) use only briefText, so the envelope briefForRun builds is thrown away. Add a `withCommitTrailers(brief, run)` helper and have each loop call formatTaskBrief or buildPromptEnvelope as it needs; cli-loop keeps both. Before finishing, run `pnpm build` in packages/hench: the test gate reads hench through dist/ and fails a run that edits source without rebuilding (the stale-dist failures of runs 31bed159 and 3aa0f093)."
lastModified: "2026-10-09T14:46:08.702Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
