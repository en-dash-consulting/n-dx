---
id: "dbdac45a-14bd-4d1c-9630-df8bb3f7d9b6"
level: "task"
title: "Show the pixel glyphs in the settings overlay sidebar and on the Settings gear"
status: "completed"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-pixel-icons"
  - "web"
blockedBy:
  - "92a1d68c-15d3-456e-af1e-82725f0e613c"
source: "claude-code: Robot Wrangler redesign session 2026-10-02"
startedAt: "2026-10-02T15:25:51.676Z"
completedAt: "2026-10-02T15:35:37.062Z"
endedAt: "2026-10-02T15:35:37.062Z"
resolutionType: "code-change"
resolutionDetail: "ViewMeta.pixelIcon + viewPixelIcon; PixelIcon in settings overlay nav/header and bottom-bar gear; robot glyph; CSS; changeset; tests."
acceptanceCriteria:
  - "Each of the four settings nav items contains an <svg> with shape-rendering=\"crispEdges\" inside .settings-overlay-item-glyph, and the settings overlay contains no 🧠 or 📤."
  - "The settings overlay header and the bottom-bar settings button render the \"settings\" glyph, and the bottom-bar button's accessible name and title are unchanged."
  - "viewGlyph(\"robot-wrangler\") returns 🤖."
  - "shell, navigation-a11y, navigation-model and accessibility tests pass, changed only where they asserted the old glyph text."
  - "A .changeset file bumps @n-dx/web as a patch."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "Wire the PixelIcon glyphs from the previous task into the settings overlay.\n\n- ViewMeta (src/viewer/views/view-meta.ts) gains an optional `pixelIcon` field naming a PixelIcon; set it for robot-wrangler, project, workflow and commands. Keep the `glyph` string for text-only consumers, but change robot-wrangler's from \\u{1F9E0} (brain) to \\u{1F916} (robot). Export a helper such as `viewPixelIcon(view)` through the same path `viewGlyph` uses (views/index.ts, then api.ts).\n- settings-overlay.ts: each settings nav item renders `PixelIcon` (variant \"glyph\", 22px) inside the existing `.settings-overlay-item-glyph` span when the view has a pixelIcon, and the text glyph otherwise. The header's gear in `.settings-overlay-glyph` becomes the \"settings\" glyph at 22px.\n- bottom-bar.ts: the button that opens settings shows the \"settings\" glyph (18 or 22px) in place of the text gear. Keep its accessible name and title unchanged.\n- CSS: size and vertically centre the svg in those spans. The active row keeps its existing highlight; do not recolour the art.\n\nOnly the settings overlay and the bottom-bar settings button change. Leave the other text-gear uses (throttle controls, cli-timeout and project-settings section icons, task-audit chips), the top nav and the stage cards as they are.\n\nAdd a patch changeset for @n-dx/web describing the new settings icons, if the branch does not already have one."
lastModified: "2026-10-02T15:35:37.459Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
