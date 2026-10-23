---
id: "92864e0c-5476-4771-b05a-e75b9859fd2e"
type: "capability"
title: "PRD write attribution and change stamps"
slug: "prd-write-attribution-and-change-stamps"
statement: "Rex stamps every local PRD mutation with a lastModified timestamp and the acting identity, and hench records the actor on each run, so the sync engine detects local edits and changes and runs can be attributed."
criteria: [{"id":"c1","text":"When an item is added, updated or removed through FolderTreeStore, rex shall stamp the item with an ISO lastModified timestamp."},{"id":"c2","text":"When an item has been edited locally since the last sync, the sync engine shall detect it as modified and push it."},{"id":"c3","text":"The folder-tree serializer and parser shall preserve the lastModified stamp across a round trip."},{"id":"c4","text":"Rex shall resolve the acting identity from git config user.name and user.email, falling back to the operating-system user when git config is unset."},{"id":"c5","text":"Rex shall cache the resolved acting identity for the life of the process."},{"id":"c6","text":"When a PRD item is mutated, rex shall stamp lastModifiedBy with the acting identity."},{"id":"c7","text":"When a log entry is appended, rex shall record the acting identity as the entry's actor."},{"id":"c8","text":"When a run starts, hench shall stamp the run record with the actor's name and email and, optionally, the host."},{"id":"c9","text":"Hench shall parse existing run records that carry no actor."},{"id":"c10","text":"When a run is summarized or shown, hench shall display the run's actor."}]
priority: "critical"
---

Discovery Option 3 (+ the sync-engine fix). Every local PRD mutation stamps lastModified and actor. This is the single highest-leverage change: it fixes SyncEngine change detection (locally edited items are currently skipped on push because FolderTreeStore never stamps lastModified), enables attribution, enables claim expiry, and gives the future merge driver a resolution timestamp.
