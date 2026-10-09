---
id: "9f75db42-5061-41fc-8d7b-312846f1dc12"
level: "feature"
title: "Apply the migration"
status: "pending"
priority: "high"
tags:
  - "product-map"
  - "pr-23"
  - "lane-migration"
  - "rex"
  - "core"
blockedBy:
  - "16a680ad-40ec-43d6-a8ea-2eedbc3e0e77"
  - "8cc70b76-8b1f-4506-8f5e-799cc153468d"
  - "a7c0061e-eb80-473b-84b2-861194fbcc47"
  - "101c4d39-8483-457f-bb2b-ac476632a426"
source: "roadmap"
acceptanceCriteria: []
description: "ndx migrate --apply <plan> moves the layout, then the schema, in one transaction. Run with the strongest model tier and --review.\n\nRoadmap PR 23 · wave 3 · lane migration."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-09T15:03:56.408Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Apply an approved plan in one transaction, re-runnable against a newer tree](./apply-an-approved-plan-in-one.md) | pending |
| [Applying a migration plan does not refuse one whose model pass is marked incomplete](./applying-a-migration-plan-does-not.md) | pending |
| [Chain layout and schema steps in ndx migrate and refuse legacy projects](./chain-layout-and-schema-steps-in-ndx.md) | pending |
| [Convert stray v1 files and warn on unreachable apply commits](./convert-stray-v1-files-and-warn-on.md) | pending |
| [Remove the prd.md and prd.json read fallbacks and the old migrate commands](./remove-the-prd-md-and-prd-json-read.md) | pending |
