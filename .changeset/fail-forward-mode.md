---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Fail-forward mode: a settings toggle that commits work as it happens instead of letting it pile up uncommitted.

With it on, an autonomous loop that finds work left in the tree after an iteration commits it and carries on, rather than refusing to continue — so an interrupted loop still leaves each finished iteration committed. The pre-run gate behaves the same way: a tree someone left dirty is committed before the run starts rather than being a reason to refuse. Settings changes commit too, including ones made from the pre-run menu, which writes the same file through the same handler as the settings page.

Every commit it makes is scoped to the paths that step touched and uses a constant message for its kind, so an operator's half-finished `git add -p` stays staged and uncommitted, and nothing needs reviewing before it lands. Commits carry the usual `N-DX` trailers. Nothing is ever pushed. Off by default, and with it off behaviour is unchanged.

The toggle is read through `isFailForwardEnabled` in `@n-dx/llm-client` rather than from the dashboard's feature registry, because `ndx work` and the hench run loop are separate processes that never reach the web server — two readers of one toggle would have drifted. The value is re-read at each decision point, so turning it off mid-run is obeyed at the next boundary rather than after a restart.

The toggle also carries an info control on the settings page explaining what is committed and when; `FeatureDefinition` gains an optional `details` field for toggles whose effects reach outside the dashboard.
