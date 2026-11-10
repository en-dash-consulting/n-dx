---
id: "c0649b8a-0921-4b30-b75a-fe35ec5afa0b"
type: "change"
title: "Runs start on a project moved to the .ndx/ layout, and the Sidecar reports a start that was refused"
slug: "runs-start-on-a-project-moved-to-the"
intent: "Found in user testing on 2026-11-05 against main a5748057f (triage: workshop analysis/sidecar/user-testing-2026-11-05.md). A tester's project on the .ndx/ layout could not run anything. hench task selection read rexDir \".rex\" from .ndx/hench/config.json, which ndx migrate-layout never rewrites, so ndx work, --resolve (the Sidecar preview: \"Task: not found in the PRD\") and --plan-queue looked in a folder that does not exist; plan-queue then said the project was \"still on v1\". When the folder was right, the pre-run gate refused because n-dx's own planning files (change folders, state.yaml, .ndx/config.json) were uncommitted, and .ndx/web-usage.jsonl is never gitignored. The Sidecar still told the user the run had started. Decision UT1: before a run, n-dx commits its own pending planning files as their own commit, then starts; any other uncommitted file still refuses."
acceptanceCriteria:
  - "On a project migrated to the .ndx/ layout with a stale hench rexDir, ndx work, --resolve and --plan-queue find the PRD (tests)"
  - "A run whose only uncommitted files are n-dx planning files starts after committing them in their own commit (tests)"
  - "A refused start never reads as started in the Sidecar (tests)"
touches:
  - "9af68a23-2d1f-4853-90a0-c81f118aaa6c"
  - "9cea889f-17de-4b92-a97e-b7279e158578"
priority: "high"
source: "ndx-capture"
---
