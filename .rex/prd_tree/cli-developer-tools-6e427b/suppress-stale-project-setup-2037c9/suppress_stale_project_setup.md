---
id: "2037c955-24ba-4fc4-9d3f-6f17ddd70139"
level: "feature"
title: "Suppress Stale Project Setup Message When All Tool Directories Exist"
status: "completed"
source: "smart-add"
startedAt: "2026-05-06T13:22:10.283Z"
completedAt: "2026-05-06T13:22:10.283Z"
endedAt: "2026-05-06T13:22:10.283Z"
acceptanceCriteria: []
description: "The 'project setup is stale' notice is currently emitted in CLI contexts where it shouldn't appear, creating noise for users with fully initialized projects. Replace the trigger heuristic with a direct filesystem check for the three tool directories (.sourcevision, .rex, .hench) and only surface the message when one or more is missing."
---

## Children

| Title | Status |
|-------|--------|
| [Add regression tests asserting stale-setup notice fires only on missing tool directories](./add-regression-tests-asserting-4cabb3/index.md) | completed |
| [Replace stale-setup trigger with direct existence check for .sourcevision, .rex, and .hench folders](./replace-stale-setup-trigger-dffc3d/index.md) | completed |
