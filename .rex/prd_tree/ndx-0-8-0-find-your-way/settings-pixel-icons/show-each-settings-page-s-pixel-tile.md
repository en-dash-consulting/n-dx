---
id: "999638c7-f926-46d4-8894-1a9546502287"
level: "task"
title: "Show each settings page's pixel tile in the Robot Wrangler, Project and Workflow page headers"
status: "in_progress"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-pixel-icons"
  - "web"
blockedBy:
  - "92a1d68c-15d3-456e-af1e-82725f0e613c"
source: "claude-code: Robot Wrangler redesign session 2026-10-02"
startedAt: "2026-10-02T15:36:05.752Z"
acceptanceCriteria:
  - "The Robot Wrangler, Project and Workflow page headers each render that page's PixelIcon tile (an svg with a navy background rect) and no longer render the n-dx logo image."
  - "The tile is 40px with a 10px radius and a 1px var(--border) border, and sits level with the page title and subtitle in both the dark and the light theme."
  - "robot-wrangler, project and workflow view tests pass, changed only where they asserted the logo."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "robot-wrangler.ts (`.llm-header-brand`), project.ts and workflow.ts each render `NdxLogoPng` at 16px beside the page title. Replace it with that page's PixelIcon tile at 40px, wrapped so the tile has a 10px radius, a 1px border in var(--border) and overflow hidden: the same look as the mascot tiles on the home page stage cards, only smaller. Align the tile with the title and subtitle block, and drop the NdxLogoPng import wherever it is no longer used.\n\nCommands has no page header and is out of scope. Make no other layout change: the Robot Wrangler page redesign is a separate feature."
lastModified: "2026-10-02T15:36:06.147Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
