---
id: "0f4f26a4-be92-4cc5-ab4a-6c47a4aae4b6"
level: "task"
title: "Pass the release gate and publish"
status: "pending"
priority: "high"
tags:
  - "pr-26"
  - "lane-migration"
  - "core"
blockedBy:
  - "1ddbce45-9768-4e21-bd5b-210f5d3cef47"
source: "roadmap"
acceptanceCriteria:
  - "Every gate item is checked off with evidence"
  - "1.0.0 is published with tags and releases"
  - "ndx ci runs the architecture-policy step and it passes, and pnpm verify actually runs the CI gate (a96f0d51 and 23ac07f7 completed)"
description: "Gate: migrate round-trips on this repository and on one Bitbucket-hosted company project; a fresh ndx init project grows a map; one hench run applies a change end to end; e2e, integration and policy suites pass on all three operating systems; specs reviewed or flagged. Then merge the held Version Packages PR."
lastModified: "2026-10-07T02:19:45.692Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
