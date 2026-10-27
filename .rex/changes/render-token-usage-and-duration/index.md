---
id: "4fdeed51-b742-4d6e-a321-42d2be246084"
type: "change"
title: "Render token usage and duration columns on the PRD tree view"
slug: "render-token-usage-and-duration"
intent: "Add columns (or inline badges) to the existing PRD tree view in the web dashboard showing total tokens and duration for every task, feature, and epic. Running tasks should show a live-updating elapsed time; completed tasks show their final duration. Values come from the new rex accessor so no client-side aggregation is needed."
acceptanceCriteria:
  - "PRD tree rows display `tokens` (formatted with thousands separators) and `duration` (human-readable: `1.2s`, `4m 10s`, `2h 15m`) for tasks, features, and epics"
  - "Rows for in-progress tasks update their duration at least once per second without refetching the whole tree"
  - "Rollup values on a parent row visually distinguish self vs. descendant contribution (e.g. tooltip or secondary text) so users can tell whether an epic's cost is concentrated in one task"
  - "UI remains usable on a PRD with 500 items — rendering and live updates stay under a 16ms-per-frame budget in a profiled test"
  - "Empty states (no runs yet, task never started) render as `—` rather than `0` to avoid implying work was done"
touches:
  - "ab5ab1c8-0e01-4db6-ada2-025504b83c89"
priority: "high"
tags:
  - "web"
  - "ui"
  - "dashboard"
source: "smart-add"
---
