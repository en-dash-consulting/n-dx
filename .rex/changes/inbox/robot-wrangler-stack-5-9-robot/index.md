---
id: "ca51f803-c1de-4bb7-82f2-e6d1e112ccca"
type: "change"
title: "Robot Wrangler stack 5/9 · Robot Wrangler page: run card, vendors, tiers, failover and review"
slug: "robot-wrangler-stack-5-9-robot"
intent: "The redesigned Robot Wrangler page. It keeps the settings-frame shell, the pixel-art header tile from #506, and every field the page edits today, but replaces the current stack of tabs, prose and bare dropdowns with five numbered sections under a run card:\n\n0. **Run card:** what the next `ndx work` run will use.\n1. **Vendor:** four selectable cards.\n2. **Connection:** radio cards for how n-dx reaches the vendor.\n3. **Models:** a tier table showing who uses each tier.\n4. **If a run fails:** failover, with an honest note when it cannot fire.\n5. **Review:** Off, Self or Pair, with reviewer settings.\n\nAll copy below is the intended text.\n\nThis is PR 5 of the 9-PR Robot Wrangler stack. The page renders only what the server resolved (PR 4): it applies no rules of its own. Code lives in `packages/web/src/viewer/views/robot-wrangler.ts` and `styles/robot-wrangler.css`, on the design tokens.\n\nGoal: A reader can tell at a glance which vendor and model each command will run on, and change it with clear selections."
acceptanceCriteria:
  - "Every field the old page edited is still editable on the new one."
  - "The page passes the existing accessibility tests, with radio groups usable by keyboard."
plannedRelease: "0.10.0"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-5"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
---

Migration suggestion (text claude-opus-5-5, not accepted): place on "ndx work Model Resolution, Display, and Vendor-Change Reset" (3d1dfc17-ba48-4fb7-8b2e-392593740605).
