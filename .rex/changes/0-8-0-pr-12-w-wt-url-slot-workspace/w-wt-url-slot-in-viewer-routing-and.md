---
id: "fe40eba6-bc8e-4d12-9b5f-f91389f3a0ca"
type: "task"
title: "/w/:wt/ URL slot in viewer routing and server dispatch; default workspace is the anchor; slot-less deep links still resolve"
slug: "w-wt-url-slot-in-viewer-routing-and"
description: "Shared: extend parsePathnameRoute / isKnownViewPath in src/shared/view-routing.ts and viewer/route-state.ts to accept an optional leading /w/<key>/ segment; use-route-state.ts pushState includes it. Server: routes-static.ts SPA catch-all accepts the slot; API and /data routes accept the slot as a prefix (strip it and resolve the workspace) and the X-Ndx-Workspace header for non-browser clients; resolveWorkspace(req) from PR 11 does the lookup. Viewer fetches carry the current workspace (one helper in external.ts / the messaging pipeline, as done for the base path in PR 8). Unknown workspace key → 404 page with a link to the anchor."
acceptanceCriteria:
  - "Route parsing tests for slot and no-slot forms."
  - "E2E: /w/<wt>/prd renders worktree wt's tree; /prd renders the anchor's."
priority: "high"
tags:
  - "pr-12"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
blockedBy:
  - "1fd545b9-b9d2-47a3-abc4-b492773aeed9"
---
