---
id: "51b80946-412a-446f-8bee-8d35364784ba"
type: "task"
title: "Tracker sync's event-source problems reach no operator: a PR rule left on with GitHub reads off does nothing, silently"
slug: "tracker-sync-s-event-source-problems"
description: "Adversarial review of bce137b2 (verdict: should-fix, severity medium). Failure: trackerSync.rules { \"pr-merged\": \"on\" } with web.sidecarGithubReads off (or gh failing every tick: not logged in, offline, rate limited). Every tick, collectTrackerEvents (packages/web/src/server/tracker/event-sources.ts readPrEvents/readReleases) returns a problem and keeps its cursor, and POST /api/tracker/sync/tick answers it in collected.problems (packages/web/src/server/routes-tracker.ts collectSince). The only caller, the hub's TrackerSyncClock (packages/web/src/hub/tracker-sync.ts), discards the body on 200, and neither the activity log nor any route keeps the problem. So the rule never fires and nothing tells the operator why. Reachable: the hub ticks every 5 minutes for any project with a rule on. Options: (A, recommended) record the latest collection problems per source in the worktree's Sidecar dir and answer them from GET /api/tracker/activity (e.g. { entries, sources: [{ event, problem, at }] }) so the Live Tracker list (a294dc86) and Settings > Connections (920b0ec3) can show them. Cheap, no schema change to activity entries. (B) Append a source-level entry to the activity log. Changes the entry shape that readers and tests rely on. (C) Have the hub log collected.problems. The hub log is invisible in the dashboard and would repeat every 5 minutes."
acceptanceCriteria:
  - "With a pr-merged rule on and GitHub reads off, a tick leaves a readable record that names web.sidecarGithubReads, answered by a tracker route (test)"
  - "A source that reads successfully again clears its recorded problem (test)"
  - "A failing gh command's first line is recorded for its source, and the cursor still does not move (test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
