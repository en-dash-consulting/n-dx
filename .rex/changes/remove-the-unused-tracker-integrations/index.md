---
id: "6e061e00-6809-4ad2-88f1-ce82fb6cfc93"
type: "change"
title: "Remove the unused tracker integrations"
slug: "remove-the-unused-tracker-integrations"
intent: "No project uses the Notion, Jira, Asana or GitHub Projects adapters, and they are built for the old whole-document model. Delete them before the 1.0.0 freeze; a new work-tracker bridge ships later as its own package. Keep rex/src/store/file-adapter.ts (the local store, used by execution-log.ts and prd-md-migration.ts).\n\nSUPERSEDED (2026-10-06): this description also said to keep the env-var resolution and credential redaction helpers from adapter-registry.ts for the future bridge. That instruction predated the deletion of their last caller. The helpers moved to src/store/adapter-config.ts when the adapters went, and were removed with that module in this feature's final task — keeping them would have frozen a credential-persistence API for a removed feature into the 1.0.0 public surface on the strength of a consumer that does not exist yet and will own its own config when it does. src/core/sync.ts (item bookkeeping, not the sync engine) is untouched.\n\nRoadmap PR 3 · wave 0 · lane rex-surface."
touches:
  - "ab9eeda9-2419-4ef0-bff4-4c20251758aa"
priority: "medium"
tags:
  - "product-map"
  - "pr-03"
  - "lane-rex-surface"
  - "rex"
  - "web"
source: "roadmap"
blockedBy:
  - "d0698e32-747d-4934-b2f8-4e698b4feef1"
---
