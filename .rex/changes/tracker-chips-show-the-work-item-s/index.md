---
id: "b53665c3-8f2f-491a-b777-ef186a4a0b6d"
type: "change"
title: "Tracker chips show the work item's current state, refreshed in the sync tick"
slug: "tracker-chips-show-the-work-item-s"
intent: "Follow-up to d3112cec (option C, chosen for later by Ryan on 2026-11-05). Today a chip's state is the status ndx last set through sync (tracker activity log), so it goes stale when someone moves the item in the tracker, and a change linked by hand has none. The sync engine (packages/web/src/server/tracker/sync-engine.ts) already polls on a tick and already reads items with the profile's readTool to confirm creates. On each tick, read the current status of linked work items (bounded per tick, oldest first) and keep it in a local cache with the time read; chips on Open changes rows and the strip read only that cache, so a Plan load never calls the tracker. Rows show the state with its age, or 'state unknown' before the first read."
acceptanceCriteria:
  - "A sync tick reads the current status of linked work items through the profile's readTool, at most a configured number per tick, and records each with the time read"
  - "Open changes rows show the cached state and its age; loading /api/tracker/changes makes no tracker tool call"
  - "A work item moved in the tracker shows its new state on the row after the next tick that reads it"
  - "Tests against the fake CAOS server cover the bounded read, the cache and a moved item"
touches:
  - "7df16224-db25-4a39-81d2-5c5c3904f4b9"
---
