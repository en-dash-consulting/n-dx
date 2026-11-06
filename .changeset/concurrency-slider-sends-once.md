---
"@n-dx/web": patch
---

The dashboard's concurrency slider sends its PUT once, when a drag ends. Under preact/compat, which the dashboard loads, its `onChange` had become an `input` listener, so every step of a drag sent a PUT and disabled the slider mid-drag.
