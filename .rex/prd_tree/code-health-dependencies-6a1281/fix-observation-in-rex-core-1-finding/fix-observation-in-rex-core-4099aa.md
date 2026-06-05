---
id: "4099aa58-c7ee-4bcd-96e7-0b563a7aaca8"
level: "task"
title: "Fix observation in rex-core: High coupling (0.67) — 2 imports target \"rex-fix\""
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-18T14:29:35.888Z"
completedAt: "2026-04-18T14:35:25.371Z"
resolutionType: "code-change"
resolutionDetail: "core/fix.ts pass-through deleted; public.ts and cli/commands/fix.ts already import directly from fix/index.js; rex-core zone dissolved, committed as a2156e8d"
acceptanceCriteria: []
description: "- High coupling (0.67) — 2 imports target \"rex-fix\""
recommendationMeta: "[object Object]"
---
