---
"@n-dx/web": patch
---

Add redirect aliases for the dashboard paths `0.8.0`'s navigation merge
orphaned: `/overview` now redirects to `/analyze`, and `/rex-dashboard` to
`/work` in the full dashboard (a rex-scoped standalone viewer, which has no
Work stage, keeps `/rex-dashboard` as its own page). The alias table lives in
`packages/web/src/shared/view-routing.ts` and is applied in three places: the
server's SPA catch-all (`routes-static.ts`, preserving any sub-path and query
string), the viewer's pathname/hash route parser, and in-app navigation
(`navigateTo`/`handleSidebarNav`) — so the bottom bar's SourceVision and Rex
status indicators, which still target the pre-merge view ids, land on the
current stage too.

`packages/web/tests/e2e-ui/navigation.spec.ts` (now a required test — see
TESTING.md) takes its view list from the `VIEW_META` navigation model instead
of a hand-kept copy that had drifted (it omitted `ask`), deep-links every
view with feature-gated ones toggled on, and asserts both aliases resolve to
their target with zero console errors.
