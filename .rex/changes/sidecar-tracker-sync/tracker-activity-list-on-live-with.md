---
id: "a294dc86-f527-475e-acd0-afbc4391493d"
type: "task"
title: "Tracker activity list on Live with card entries and sign-in state"
slug: "tracker-activity-list-on-live-with"
description: "Story 45, part 3. A Tracker activity section on Live (packages/web/src/viewer/views/domain-live.ts / components/live-tab.ts) reads GET /api/tracker/activity: each sync with its time, item, event, call and result (would, ok, duplicate, refused with its problems, card, unavailable, sign in again). Card entries (creation, blocked, missing facts, limits) offer Approve (runs the planned call with the operator's edits on the C1 form card) and Dismiss. A connection whose OAuth refresh was revoked shows 'sign in again' with a link to Settings > Connections. Only shown while web.sidecar is on and a trackerSync connection is configured. Check dark and light themes. Follow the shared rules in the parent change's description."
acceptanceCriteria:
  - "Live lists the activity log's entries with their results, including a dry-run 'would' and a refusal's problems (viewer tests)"
  - "Approving a card entry runs its call once and records the result; Dismiss records it dismissed (tests)"
  - "A needs-sign-in connection shows 'sign in again' in the Tracker list (viewer test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "caos"
---
