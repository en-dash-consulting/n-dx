---
id: "6e061e00-6809-4ad2-88f1-ce82fb6cfc93"
level: "feature"
title: "Remove the unused tracker integrations"
status: "pending"
priority: "medium"
tags:
  - "product-map"
  - "pr-03"
  - "lane-rex-surface"
  - "rex"
  - "web"
blockedBy:
  - "d0698e32-747d-4934-b2f8-4e698b4feef1"
source: "roadmap"
startedAt: "2026-10-06T17:03:19.346Z"
endedAt: "2026-10-06T17:03:19.346Z"
acceptanceCriteria: []
description: "No project uses the Notion, Jira, Asana or GitHub Projects adapters, and they are built for the old whole-document model. Delete them before the 1.0.0 freeze; a new work-tracker bridge ships later as its own package. Keep rex/src/store/file-adapter.ts (the local store, used by execution-log.ts and prd-md-migration.ts).\n\nSUPERSEDED (2026-10-06): this description also said to keep the env-var resolution and credential redaction helpers from adapter-registry.ts for the future bridge. That instruction predated the deletion of their last caller. The helpers moved to src/store/adapter-config.ts when the adapters went, and were removed with that module in this feature's final task — keeping them would have frozen a credential-persistence API for a removed feature into the 1.0.0 public surface on the strength of a consumer that does not exist yet and will own its own config when it does. src/core/sync.ts (item bookkeeping, not the sync engine) is untouched.\n\nRoadmap PR 3 · wave 0 · lane rex-surface."
lastModified: "2026-10-07T02:58:25.130Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Address Hal's should-fix review findings on the tracker removal](./address-hal-s-should-fix-review.md) | in_progress |
| [Delete the rex tracker adapters, rex sync, rex adapter and the sync_with_remote tool](./delete-the-rex-tracker-adapters-rex.md) | completed |
| [Remove the dashboard's Notion and integration routes, flags and setup views](./remove-the-dashboard-s-notion-and.md) | completed |
| [Remove the tracker integration docs and record the removal](./remove-the-tracker-integration-docs.md) | completed |
| [rex exports adapters.json persistence and credential helpers with no remaining consumer](./rex-exports-adapters-json-persistence.md) | completed |
