---
"@n-dx/rex": patch
---

A change's landing on main is worked out from git history alone: the first-parent merge commit that carries its `N-DX-Item` trailer commits, or the commit itself when fast-forwarded or rebased. A squash merge reports `landed: false` with the reason. Landings are cached under `.ndx/rex/.cache`. `shippedIn` falls back to the first release tag containing the landing commit when no stamp exists.
