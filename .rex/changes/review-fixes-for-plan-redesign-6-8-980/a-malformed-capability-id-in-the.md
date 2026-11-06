---
id: "61981436-d7f0-4d4b-b4b3-bc00ecc887a1"
type: "task"
title: "A malformed capability id in the address falls back to the area"
slug: "a-malformed-capability-id-in-the"
description: "Stack review finding on #980 at packages/web/src/viewer/route-state.ts:46 (review comment 4488638355).\n\n**Should fix: a malformed capability id in the address throws during render**\n\n`decodeURIComponent(id)` has no guard, and `AREA_PATH` accepts any `[^/]+`. An address like `/product/area/x/capability/%E0` throws a `URIError` inside the product renderer. There is no error boundary around `renderActiveView`, so the dashboard goes blank instead of falling back to the area. Wrap the decode in try/catch and return null, which the view already treats as no selection. S7's `placeChangeOfTab` repeats the same pattern."
acceptanceCriteria:
  - "route-state.ts guards decodeURIComponent and returns null for a malformed capability id instead of throwing during render"
  - "A test opens an area address with a malformed capability segment and the area renders"
---
