---
id: "f367bfaa-691c-4153-87f4-6ae5f2b8e2ce"
type: "task"
title: "Changes view: newest release first, open work leading, applied collapsed, descriptions clamped"
slug: "changes-view-newest-release-first-open"
description: "In `views/product-model.ts` (`groupChangesByRelease`) and `views/changes.ts`: order releases newest first by semver, with Unscheduled first when it has open changes. Within a group, open stages lead and applied/shipped changes collapse behind \"N applied ▸\". Clamp each intent to two lines with \"more\". Keep the existing data-* attributes tests rely on, and update `tests/unit/viewer` changes-view tests for the new order."
acceptanceCriteria:
  - "Groups order newest release first, Unscheduled first when it has open work"
  - "Applied changes collapse behind a count per group and expand on request"
  - "Intents clamp to two lines with an expand control"
  - "View tests cover the order, collapse and clamp"
priority: "medium"
tags:
  - "web"
  - "changes-view"
source: "ndx-capture"
---
