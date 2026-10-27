---
id: "d519390b-e500-4cff-a9ae-6cfb76c29b32"
type: "task"
title: "Fix code in web-helpers: getLevelEmoji is imported as a runtime function from web-viewer's prd-tree/level"
slug: "fix-code-in-web-helpers-getlevelemoji"
description: "- getLevelEmoji is imported as a runtime function from web-viewer's prd-tree/levels.ts — this cross-zone dependency cannot be eliminated by type-only import refactoring; the call site must be refactored (inject as prop or move getLevelEmoji to a shared location accessible without importing from web-viewer) before the zone-level cycle is broken."
priority: "critical"
source: "sourcevision"
---
