---
id: "a1062845-51ec-48be-b909-54d0a549f6cd"
type: "change"
title: "Fix Inaccurate File-Change Reporting in Run Summary and Dashboard"
slug: "fix-inaccurate-file-change-reporting"
intent: "The run summary and dashboard are reporting zero changed files for runs whose commits demonstrably touched files. This breaks the change-classification gate above, the dashboard's per-run change column, and operator trust in run telemetry. The fault is in how the run records changed-file evidence (likely a stale or wrong-cwd git diff capture, or a captured snapshot taken before the commit) rather than in the commit itself."
touches:
  - "9af68a23-2d1f-4853-90a0-c81f118aaa6c"
source: "smart-add"
---
