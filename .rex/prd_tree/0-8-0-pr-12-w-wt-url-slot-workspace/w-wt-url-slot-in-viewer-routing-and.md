---
id: "fe40eba6-bc8e-4d12-9b5f-f91389f3a0ca"
level: "task"
title: "/w/:wt/ URL slot in viewer routing and server dispatch; default workspace is the anchor; slot-less deep links still resolve"
status: "completed"
priority: "high"
tags:
  - "pr-12"
  - "web"
blockedBy:
  - "1fd545b9-b9d2-47a3-abc4-b492773aeed9"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-16T16:45:21.211Z"
completedAt: "2026-09-16T16:49:24.332Z"
endedAt: "2026-09-16T16:49:24.332Z"
resolutionType: "code-change"
resolutionDetail: "/w/<key>/ slot composed into the viewer base path and stripped server-side before dispatch with registry lookup, X-Ndx-Workspace header support and a 404 page for unknown keys; slot-less paths stay the anchor's; parsing tests and a compiled-server integration test green."
acceptanceCriteria:
  - "Route parsing tests for slot and no-slot forms."
  - "E2E: /w/<wt>/prd renders worktree wt's tree; /prd renders the anchor's."
description: "Shared: extend parsePathnameRoute / isKnownViewPath in src/shared/view-routing.ts and viewer/route-state.ts to accept an optional leading /w/<key>/ segment; use-route-state.ts pushState includes it. Server: routes-static.ts SPA catch-all accepts the slot; API and /data routes accept the slot as a prefix (strip it and resolve the workspace) and the X-Ndx-Workspace header for non-browser clients; resolveWorkspace(req) from PR 11 does the lookup. Viewer fetches carry the current workspace (one helper in external.ts / the messaging pipeline, as done for the base path in PR 8). Unknown workspace key → 404 page with a link to the anchor."
lastModified: "2026-09-16T16:49:24.708Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
