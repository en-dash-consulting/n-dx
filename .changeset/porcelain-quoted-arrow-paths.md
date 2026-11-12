---
"@n-dx/hench": patch
---

Leftover-work checks preserve quoted rename and copy paths.

The checks split each line using git's quoting, so a source or target containing ` -> ` is read whole instead of being cut at the wrong arrow.
