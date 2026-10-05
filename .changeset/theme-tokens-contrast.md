---
"@n-dx/web": patch
---

Task blockers, start notices and error toasts use the theme's `--text-dim` and `--red` tokens instead of undefined `--text-secondary` and `--danger`, so they meet AA contrast in both themes. A test now rejects those names and checks fallback-guarded tokens in the Prepare task stylesheet.
