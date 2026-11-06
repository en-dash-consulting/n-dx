---
id: "b9eafb84-4936-4b00-92f5-793124072042"
type: "task"
title: "The configuration guide still describes hench.readyNext as lanes of ready tasks"
slug: "the-configuration-guide-still"
description: "Adversarial review of 785c4836 (should-fix, low). docs/guide/configuration.md:343 still describes `hench.readyNext` as \"Ready next: lanes of ready tasks that can run side by side\". The dashboard toggle (packages/web/src/server/routes-features.ts:176), `ndx work --help` and the Ready next view now say \"track\". A reader of the guide therefore sees a different word from the one on screen. The fix is a one-word docs edit, which fits the sibling Docs task or stands alone."
acceptanceCriteria:
  - "docs/guide/configuration.md describes hench.readyNext with track, matching the dashboard toggle's description"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
