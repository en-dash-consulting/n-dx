---
id: "277ca835-dd06-41ef-90c0-b2f026843880"
type: "change"
title: "Compute intent status and health for product nodes"
slug: "compute-intent-status-and-health-for"
intent: "Intent: proposed, changing (open amendment), met (hash equals metAt and checks pass), revised (hash differs, no open change), retired. Health: defective when an open fix touches it or a check fails, otherwise ok. Constraints get health too."
acceptanceCriteria:
  - "Each status and health value has a fixture test"
  - "Status is never written to intent files"
touches:
  - "4cd7c27a-13d3-4fd3-85b4-9f309a4237fd"
priority: "medium"
tags:
  - "pr-11"
  - "lane-rex-domain"
  - "rex"
source: "roadmap"
---
