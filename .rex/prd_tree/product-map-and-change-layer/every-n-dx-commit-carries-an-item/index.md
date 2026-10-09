---
id: "298f7764-ed49-435a-8e4b-ada4c4c6f5a1"
level: "feature"
title: "Every n-dx commit carries an item trailer"
status: "pending"
priority: "medium"
tags:
  - "product-map"
  - "pr-05"
  - "lane-hench"
  - "hench"
  - "core"
blockedBy:
  - "c81707dc-7c9a-47ba-9043-9a588a87ac76"
source: "roadmap"
startedAt: "2026-10-08T20:11:16.792Z"
acceptanceCriteria: []
description: "The evidence layer and the realized-by edge need commits tied to items. Today only hench auto-commits carry N-DX-Item, and its value is a dashboard URL (usually localhost). The trailer format freezes at 1.0.0, so its value becomes the item id.\n\nRoadmap PR 5 · wave 0 · lane hench."
assignee: "Sterling H <sterling.h@endash.us>"
lastModified: "2026-10-08T20:26:50.764Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A CRLF commit message drops the agent's own trailers out of the final trailer block](./a-crlf-commit-message-drops-the-agent.md) | pending |
| [Add the item trailer to skill, PRD-write and operator commits](./add-the-item-trailer-to-skill-prd.md) | completed |
| [Report commits that carry no item trailer](./report-commits-that-carry-no-item.md) | pending |
| [Review-repair commits carry the N-DX-Item trailer](./review-repair-commits-carry-the-n-dx.md) | completed |
| [Skill commit-message scratch file works in linked worktrees](./skill-commit-message-scratch-file.md) | pending |
| [Skill commit steps stage only their own changes](./skill-commit-steps-stage-only-their.md) | pending |
| [Timer-expiry auto-commit carries hench's trailers](./timer-expiry-auto-commit-carries-hench.md) | pending |
| [Write one final trailer block on every hench commit](./write-one-final-trailer-block-on-every.md) | completed |
| [Write the item id as the N-DX-Item trailer value](./write-the-item-id-as-the-n-dx-item.md) | completed |
