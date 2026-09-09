---
"@n-dx/web": patch
---

Gate the Explain action on the `sourcevision.ask` toggle.

`sourcevision.ask` is experimental and defaults to off, and its impact text says
each question spends tokens. The tab list and the sidebar both honoured it; the
**Explain** button on Problems and Suggestions rows did not. On a default
install that left Ask fully reachable — finding row → Explain → panel → submit →
tokens — through the one entry point that is not in the sidebar, while the only
control that could turn it off is hidden by the very toggle that is off.

Both views now take the toggle as a prop and omit the action when it is false,
on the same branch that already omitted it when the surface has nowhere to
navigate. The prop defaults to `false`, so a call site that forgets it renders
no button rather than an ungated one.

The toggle is read in `main.ts` rather than in the views: the view-registry
renderers are plain functions dispatched by view id, so a hook called inside one
would be a conditional hook in `App`, and Problems and Suggestions both return
early from an enrichment gate before their own hooks run.

Tests cover the button's absence in both views with the toggle off and with the
prop omitted, plus the registry wiring that supplies it — dropping the prop
there would have restored the old behaviour with every component-level
assertion still passing.

The endpoint enforces the same toggle — see the separate changeset for
`POST /api/sourcevision/ask`.
