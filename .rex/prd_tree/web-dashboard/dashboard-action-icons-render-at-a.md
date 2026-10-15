---
id: "3c2af4a4-7106-47c7-84a4-755efd5c488c"
level: "task"
title: "Dashboard action icons render at a readable size from one shared SVG icon set"
status: "pending"
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "a11y"
  - "icons"
source: "ndx-capture"
acceptanceCriteria:
  - "A shared icon component renders copy, check, close and more as inline SVG sized by one CSS token (16px by default) and coloured by currentColor."
  - "The Next Steps per-item copy button uses the copy icon (check while copied) and its click target is at least 24×24px."
  - "Close (✕/×) and more (⋯) action buttons across the viewer use the shared icon instead of a text glyph, keeping their aria-labels."
  - "Status glyphs used as text markers (deleted, failed) are unchanged."
description: "User report: the Next Steps copy icon, and icons elsewhere, are very small. Action buttons in the viewer draw their icon as a Unicode glyph sized by the button's font-size: copy is `⎘` at 13px (overview.ts), close buttons use `✕` or `×` in ~20 components with varied font sizes, and \"more\" uses `⋯`. Glyph metrics vary by font, so several render a few pixels tall. Add one shared inline-SVG icon component (currentColor, sized by a single `--icon-size` token) for copy, check, close and more, and use it for those action buttons. Status markers inside text (deleted/failed ✕, ✓ results) are out of scope."
lastModified: "2026-10-15T02:50:33.751Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
