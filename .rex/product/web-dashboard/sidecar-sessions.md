---
id: "1710be37-554f-47bf-a9e0-609a6ab90768"
type: "capability"
title: "Sidecar sessions"
slug: "sidecar-sessions"
statement: "The dashboard server holds operator Sidecar sessions with a vendor CLI that resume across restarts, relay each turn as announced frames, and route every side effect through one broker that waits on the operator's permission card."
criteria: [{"id":"c1","text":"When the dashboard server restarts, the Sidecar shall resume each live session from its stored vendor session id."},{"id":"c2","text":"When an operator posts a turn, the Sidecar shall append the turn's frames to the session transcript and announce a cursor over the WebSocket for the client to fetch after."},{"id":"c3","text":"When a Sidecar session requests a side effect, the ndx-sidecar broker shall hold it until its permission card is decided or the action matches the allow-list, and shall never allow-list work, edits, PRD writes, placements, migration decisions or posts."},{"id":"c4","text":"When a turn ends above the session's context ceiling, the Sidecar shall start the next turn cold from a fresh lens packet, the session ledger and the last two exchanges."},{"id":"c5","text":"While web.sidecar is off, the dashboard server shall refuse every Sidecar route."}]
---

## History

- 2026-11-07 9753d37a-2e7e-4950-8eba-3015eee08734 added: Add the Sidecar sessions capability that the M1 core delivers
