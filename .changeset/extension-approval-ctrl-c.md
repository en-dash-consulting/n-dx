---
"@n-dx/core": patch
---

Ctrl+C at an extension's approval prompt — on its first run or at `ndx extensions enable` — now exits 130 quietly and approves nothing, instead of exiting 1 with an AbortError.
