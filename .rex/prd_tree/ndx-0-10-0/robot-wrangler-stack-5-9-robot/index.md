---
id: "ca51f803-c1de-4bb7-82f2-e6d1e112ccca"
level: "feature"
title: "Robot Wrangler stack 5/9 · Robot Wrangler page: run card, vendors, tiers, failover and review"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-5"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "Every field the old page edited is still editable on the new one."
  - "The page passes the existing accessibility tests, with radio groups usable by keyboard."
description: "The redesigned Robot Wrangler page. It keeps the settings-frame shell, the pixel-art header tile from #506, and every field the page edits today, but replaces the current stack of tabs, prose and bare dropdowns with five numbered sections under a run card:\n\n0. **Run card:** what the next `ndx work` run will use.\n1. **Vendor:** four selectable cards.\n2. **Connection:** radio cards for how n-dx reaches the vendor.\n3. **Models:** a tier table showing who uses each tier.\n4. **If a run fails:** failover, with an honest note when it cannot fire.\n5. **Review:** Off, Self or Pair, with reviewer settings.\n\nAll copy below is the intended text.\n\nThis is PR 5 of the 9-PR Robot Wrangler stack. The page renders only what the server resolved (PR 4): it applies no rules of its own. Code lives in `packages/web/src/viewer/views/robot-wrangler.ts` and `styles/robot-wrangler.css`, on the design tokens.\n\nGoal: A reader can tell at a glance which vendor and model each command will run on, and change it with clear selections."
lastModified: "2026-10-10T23:40:43.111Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add the Review section: Off, Self review and Pair review, with reviewer vendor, model and fix rounds](./add-the-review-section-off-self-review.md) | pending |
| [Rebuild the failover control as a section that shows the chain and says when failover cannot fire](./rebuild-the-failover-control-as-a.md) | pending |
| [Replace the agent, project and light model fields with a tier table that shows what each tier is used by](./replace-the-agent-project-and-light.md) | pending |
| [Replace the credentials chip and the will-run-with block with a run card that previews unsaved edits](./replace-the-credentials-chip-and-the.md) | pending |
| [Replace the vendor tabs with selectable vendor cards and the provider dropdown with connection cards](./replace-the-vendor-tabs-with.md) | pending |
