---
"@n-dx/web": patch
---

Enforce feature toggles on the server, not only in the sidebar

A toggle that only hid a nav entry left its endpoints open to anything that
could reach the port. Turning off `sourcevision.ask` — the one toggle over a
token-spending endpoint — hid the panel but left its two write endpoints
(`/api/rex/capture-ask`, `/api/rex/apply-refinements`) reachable; the same held
for the PR Markdown, Notion and Integrations surfaces.

Every endpoint governed by a toggle is now declared in
`server/route-feature-gates.ts` and refused with a 403 naming the flag, before
dispatch. A test fails if a nav `featureGate` gains no server entry, so a
toggle cannot go back to being nav-only.
