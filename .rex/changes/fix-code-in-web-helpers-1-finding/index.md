---
id: "4bc33a6b-3827-44e3-8e6d-154653c9b4c3"
type: "change"
title: "Fix code in web-helpers (1 finding)"
slug: "fix-code-in-web-helpers-1-finding"
intent: "- getLevelEmoji is imported as a runtime function from web-viewer's prd-tree/levels.ts — this cross-zone dependency cannot be eliminated by type-only import refactoring; the call site must be refactored (inject as prop or move getLevelEmoji to a shared location accessible without importing from web-viewer) before the zone-level cycle is broken."
touches:
  - "136a8c3e-485e-4a79-8a82-0241d5479005"
priority: "critical"
source: "sourcevision"
---
