---
id: "de68b4c2-33ad-446d-83d8-bc74383ba236"
level: "task"
title: "Show a change summary, a Discard button and a clearly disabled Save in the shared settings save bar"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-6"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "Robot Wrangler's footer shows the count and first change summary while dirty, and Discard restores the saved values."
  - "A disabled Save is visibly distinct from an enabled one in both themes."
  - "Project and Workflow still save and discard as before."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "Extend `SettingsFrame` (`packages/web/src/viewer/components/settings-frame.ts`) with an optional `changeSummary?: string[]`.\n\n- When dirty, the footer reads \"N unsaved change(s) · <first summary>\" beside a dirty dot.\n- A Discard button calls the existing `onDiscard`.\n- A disabled Save uses a muted surface and muted text (for example `--bg-active` and `--text-muted`) rather than half-opacity on the accent fill, which reads as enabled.\n\nRobot Wrangler passes summaries such as \"Vendor claude → codex\" or \"Heavy model → claude-opus-5\". Project and Workflow get the Discard button and the disabled look without passing summaries."
lastModified: "2026-10-10T23:41:10.639Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
