---
"@n-dx/web": patch
---

The hub home docks the hub session. When the project server that would host it can run the hub lens (`web.sidecar` on), the header shows a "Hub session" toggle (⌘J) that opens a drawer beside the project cards. The drawer is a drawer-only dashboard page served through the hub at `/hub/session/drawer`, so the home page stays server-rendered. Its head reads "Hub session" with a purple "Hub · all projects" chip, how many snapshot items changed since your last turn, and the Hub lens. Its composer says "read-only · drafts" and meters the session's context against the hub ceiling (40k by default). Project servers answer `GET /api/sidecar/hub/lens` and `/drawer`; the host answers `/snapshot`, which reads the Δ count without moving the session's fingerprints.
