---
"@n-dx/hench": patch
---

hench counts a v2 tree's `product/` and `changes/` folders (both `.rex` and `.ndx/rex` layouts) as PRD bookkeeping, so a completion's `state.yaml` writes no longer trigger the full-suite gate, read as reviewer repairs or show up in the completion diff.
