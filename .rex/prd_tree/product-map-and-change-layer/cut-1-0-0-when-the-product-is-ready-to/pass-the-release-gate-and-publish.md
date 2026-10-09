---
id: "0f4f26a4-be92-4cc5-ab4a-6c47a4aae4b6"
level: "task"
title: "Pass the release gate and publish"
status: "deferred"
priority: "high"
tags:
  - "release"
  - "core"
blockedBy:
  - "b2d8b4c9-e780-498e-9195-3ab07036fd42"
source: "roadmap"
acceptanceCriteria:
  - "Every gate item is checked off with evidence"
  - "1.0.0 is published with tags and releases"
  - "ndx ci runs the architecture-policy step and it passes, and pnpm verify actually runs the CI gate (a96f0d51 and 23ac07f7 completed)"
description: "Gate: migrate round-trips on this repository and on one Bitbucket-hosted company project; a fresh ndx init project grows a map; one hench run applies a change end to end; e2e, integration and policy suites pass on all three operating systems; specs reviewed or flagged. Then merge the held Version Packages PR."
lastModified: "2026-10-09T19:08:05.594Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
