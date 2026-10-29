---
id: "9a784d5f-3468-4e89-acc1-6395304c4fd4"
type: "task"
title: "Dashboard extension links are missing on a worktree page under the single-project root alias"
slug: "dashboard-extension-links-are-missing"
description: "Verdict: should-fix. With one project registered and a worktree dashboard at /w/<key>/, extensionLinksPath (packages/web/src/viewer/components/extension-links.ts:52-55) returns /api/hub/extensions without ?project=, installBasePathFetch makes it /w/<key>/api/hub/extensions, and the hub's detectBasePath only recognises /p/, so scopedProjectId is null and no links come back; the header silently shows none. Fix (recommended): have the hub default scopedProjectId to the sole project when exactly one is registered; alternatively send ?project= whenever the base path names no /p/ id."
acceptanceCriteria:
  - "A worktree dashboard under the single-project root alias shows the project's extension links"
  - "A test covers the /w/<key>/ base path"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
