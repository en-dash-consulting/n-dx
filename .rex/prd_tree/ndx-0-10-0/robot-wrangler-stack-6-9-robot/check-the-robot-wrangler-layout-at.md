---
id: "51ea3d22-400e-4c1b-b3c7-2f429e282f9d"
level: "task"
title: "Check the Robot Wrangler layout at phone, tablet and desktop widths, remove dead styles, and update docs and the changeset"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-6"
blockedBy:
  - "707c2af1-5e6e-4033-ae1a-119ebc5891e7"
  - "2d0c1a65-30e2-4345-970c-19cc973a4010"
  - "cde76eae-29c1-4e87-ba0a-c1cb293eb873"
  - "66468883-4570-4ac2-9252-bbbd81f9528a"
  - "716b508b-63e4-4bb3-b83a-80f107065f82"
  - "5629434c-af5a-4890-9296-f9d8e9f35f6e"
  - "de68b4c2-33ad-446d-83d8-bc74383ba236"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "At 375, 768 and 1280px the page has no horizontal scroll and the stated stacking holds (visual check in both themes)."
  - "No CSS class in robot-wrangler.css is unused by the view."
  - "Docs describe the new sections; a patch changeset for @n-dx/web exists."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "Make the page fit each width:\n- Below 768px, the vendor grid drops from 4 columns to 2.\n- Below 640px, tier rows and review cards stack.\n- Nothing scrolls horizontally at 375px.\n\nRemove the CSS classes the old layout used that nothing renders any more.\n\nUpdate the user-facing docs that describe Robot Wrangler or the LLM settings: search `docs/`, `README.md` and the package `AGENTS.md` files, and keep AGENTS.md as the canonical assistant guidance.\n\nAdd a patch changeset for `@n-dx/web` covering the redesign."
lastModified: "2026-10-10T23:41:14.017Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
