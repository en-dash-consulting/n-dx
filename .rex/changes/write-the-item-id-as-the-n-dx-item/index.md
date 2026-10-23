---
id: "5ee70ad3-313d-46f0-b99c-592d5e49dc74"
type: "change"
title: "Write the item id as the N-DX-Item trailer value"
slug: "write-the-item-id-as-the-n-dx-item"
intent: "Change hench/src/agent/lifecycle/shared.ts (the trailer append near the publicUrl build) and core/commit-trailers.js so N-DX-Item carries the item id. Readers (backfill-commit-attribution and any parser) accept both the new id form and the old URL form."
acceptanceCriteria:
  - "New hench commits carry N-DX-Item: <item id>"
  - "Parsers accept both the id and the legacy URL form (tests)"
touches:
  - "298f7764-ed49-435a-8e4b-ada4c4c6f5a1"
priority: "medium"
tags:
  - "pr-05"
  - "lane-hench"
  - "hench"
  - "core"
source: "roadmap"
---
