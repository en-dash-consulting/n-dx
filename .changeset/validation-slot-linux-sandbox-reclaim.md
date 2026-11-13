---
"@n-dx/hench": patch
---

On Linux, the host validation slot is now reclaimed after a sandboxed holder exits, so later test gates no longer wait forever behind a slot nobody holds.

Before, hench treated some of your own processes that Linux will not let it inspect as possibly the gone holder. It now skips processes that cannot be inside a sandbox.
