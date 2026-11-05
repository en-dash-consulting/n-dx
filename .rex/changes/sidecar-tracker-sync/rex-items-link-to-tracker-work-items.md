---
id: "4700837f-49cb-43f1-8488-17dcc3b6e9dc"
type: "task"
title: "Rex items link to tracker work items and show the link"
slug: "rex-items-link-to-tracker-work-items"
description: "Story 44 (CAOS 3f7a80b7-1924-8184-87c7-f0e1c2d5db03). A tracker link is a work ref in the item's v2 issues (isWorkRef in packages/rex/src/schema/v2.ts accepts URLs and tracker keys) or v1 frontmatter links[]. Link and unlink actions on the task and change pages (through the existing rex gateway / edit routes, no new rex export unless designed away), the link shown on task, change and Live pages with the tracker's label from the profile, and a broker tool propose_link { itemId, ref } that raises a link card (never allow-listable) so the Sidecar proposes links. Confirm the v1 to v2 migration carries links[] into issues. Follow the shared rules in the parent change's description."
acceptanceCriteria:
  - "Link and unlink on a task and on a change write and remove the ref in v2 issues, and on a v1 item in links[] (tests)"
  - "The link shows on the task, change and Live pages (viewer tests)"
  - "A v1 item's links[] survive the v1 to v2 migration as issues (rex test)"
  - "propose_link raises a link card that writes the ref only on Approve and is never allow-listable (broker test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "caos"
---
