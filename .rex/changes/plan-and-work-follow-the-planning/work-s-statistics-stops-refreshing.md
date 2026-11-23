---
id: "3c0acf95-96b4-4059-8292-4781cb7770e5"
type: "task"
title: "Work's Statistics stops refreshing after its tile is opened full-screen and closed"
slug: "work-s-statistics-stops-refreshing"
summary: "The PRD numbers on the Work page freeze after you open the Statistics section full-screen and close it again, until the page is reloaded."
description: "Failure: useDashboardData (views/rex-dashboard.ts) registers usePolling('rex-dashboard', ...), and both WorkStats (the tile body) and RexDashboard (the opened full-screen view) mount it at once. registerPoller replaces an existing key, and the unregister it returns (polling/polling-manager.ts:191) removes the key whoever holds it, so closing the full-screen view removes the tile's poller. Trigger: open Work, open Statistics full-screen, close it, complete a task: the tile keeps the old numbers. Reachability: the Statistics tile's own header. Verdict: must-fix (medium), introduced by efcc0da8e. Fix (recommended): give each useDashboardData instance its own polling key (a useRef counter appended to 'rex-dashboard'). A few lines plus a test."
acceptanceCriteria:
  - "Mounting WorkStats and RexDashboard together, then unmounting RexDashboard, leaves WorkStats polling (unit test with the polling manager)"
  - "Two dashboard readers never share a polling key"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
