---
"@n-dx/hench": patch
---

The leftover-work checks split a rename or copy line by git's quoting, so a source or target whose name contains ` -> ` is read whole instead of being cut at the wrong arrow.
