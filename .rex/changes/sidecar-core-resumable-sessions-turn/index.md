---
id: "9753d37a-2e7e-4950-8eba-3015eee08734"
type: "change"
title: "Sidecar core: resumable sessions, turn relay and action broker"
slug: "sidecar-core-resumable-sessions-turn"
intent: "Batch M1 of the Sidecar epic (CAOS 3f7a80b7-1924-8104-9ed8-c98bc5f409e4, feature Sidecar session API and relay 3dfa80b7-1924-81ec-a44f-c44ded6cc34d). The server-side substrate every Sidecar lens runs on: an llm-client session API lifted from hench's resume adapters, a per-worktree session registry, POST-turn plus announced-frame transport, one ndx-sidecar broker MCP server that raises permission cards, a context ceiling with a typed ledger, and bounded lens packets. Merges behind web.sidecar and turns on with the drawer (M2) and first lenses (M3) as the 0.11.0 MVP. Design: local-design-workshop/docs/analysis/sidecar/README.md §3-4, §12, §15."
acceptanceCriteria:
  - "Stories 01-06 of the Sidecar design (§12, Session API and relay) are complete"
  - "No Sidecar route is reachable while web.sidecar is off"
amends: [{"target":"1710be37-554f-47bf-a9e0-609a6ab90768","delta":"added","summary":"Add the Sidecar sessions capability that the M1 core delivers","criteria":{"add":[{"id":"c1","text":"When the dashboard server restarts, the Sidecar shall resume each live session from its stored vendor session id."},{"id":"c2","text":"When an operator posts a turn, the Sidecar shall append the turn's frames to the session transcript and announce a cursor over the WebSocket for the client to fetch after."},{"id":"c3","text":"When a Sidecar session requests a side effect, the ndx-sidecar broker shall hold it until its permission card is decided or the action matches the allow-list, and shall never allow-list work, edits, PRD writes, placements, migration decisions or posts."},{"id":"c4","text":"When a turn ends above the session's context ceiling, the Sidecar shall start the next turn cold from a fresh lens packet, the session ledger and the last two exchanges."},{"id":"c5","text":"While web.sidecar is off, the dashboard server shall refuse every Sidecar route."}]},"proposed":"The dashboard server holds operator Sidecar sessions with a vendor CLI that resume across restarts, relay each turn as announced frames, and route every side effect through one broker that waits on the operator's permission card.","under":"4d62fa6c-ad0d-4e1e-91f8-c2f1ebe696e7","title":"Sidecar sessions","type":"capability"}]
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "high"
source: "caos"
---
