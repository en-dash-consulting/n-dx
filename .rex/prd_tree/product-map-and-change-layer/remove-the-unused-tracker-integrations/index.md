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
acceptanceCriteria: []
description: "No project uses the Notion, Jira, Asana or GitHub Projects adapters, and they are built for the old whole-document model. Delete them before the 1.0.0 freeze; a new work-tracker bridge ships later as its own package. Keep rex/src/store/file-adapter.ts (the local store, used by execution-log.ts and prd-md-migration.ts) and keep the env-var resolution and credential redaction helpers from adapter-registry.ts.\n\nRoadmap PR 3 · wave 0 · lane rex-surface."
lastModified: "2026-10-06T04:19:11.017Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Delete the rex tracker adapters, rex sync, rex adapter and the sync_with_remote tool](./delete-the-rex-tracker-adapters-rex.md) | pending |
| [Remove the dashboard's Notion and integration routes, flags and setup views](./remove-the-dashboard-s-notion-and.md) | pending |
| [Remove the tracker integration docs and record the removal](./remove-the-tracker-integration-docs.md) | pending |
