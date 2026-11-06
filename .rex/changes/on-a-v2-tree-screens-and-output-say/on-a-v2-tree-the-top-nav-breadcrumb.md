---
id: "5d18cc19-98d9-4045-8ff8-0920f44875eb"
type: "task"
title: "On a v2 tree the top nav, breadcrumb and page title still call the tree view \"Tasks\""
slug: "on-a-v2-tree-the-top-nav-breadcrumb"
description: "Verdict should-fix (low). d143adff added a v2 label \"Change tree\" to VIEW_META.prd, read through viewLabelFor/viewBlurbFor (packages/web/src/viewer/views/view-meta.ts). Only the PRD view header (views/prd.ts) reads it. Every other consumer still calls viewLabel/viewBlurb: the top nav, the breadcrumb, document.title, the guide, the settings overlay and the stage sections. Scenario: open #prd on a v2 project → the header says \"Change tree\", but the breadcrumb and the browser tab say \"Tasks\". The Up Next v2 blurb is unread for the same reason. Reachable from any v2 dashboard. Options: (a, recommended) thread the layout to these consumers (usePrdLayout or useProjectStatus().rex.layout) and swap viewLabel for viewLabelFor at each call site — a small diff, and the navigation-model uniqueness test still holds. (b) Make viewLabel itself read a module-level layout — less code, but hidden global state. Keep the edits to labels so the Plan redesign restack (#961–#988) stays simple."
acceptanceCriteria:
  - "On a v2 tree the breadcrumb and document.title for the prd view read \"Change tree\" (viewer test)"
  - "On a v1 tree they still read \"Tasks\" (viewer test)"
  - "No caller of viewLabel or viewBlurb for prd or rex-dashboard renders v1 words on a v2 tree"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
