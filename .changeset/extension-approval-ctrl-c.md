---
"@n-dx/core": patch
---

Ctrl+C at an extension's first-run approval prompt now exits 130 quietly and approves nothing, instead of exiting 1 with an AbortError.
