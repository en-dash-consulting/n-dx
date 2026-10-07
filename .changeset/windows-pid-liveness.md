---
"@n-dx/hench": patch
"@n-dx/web": patch
---

On Windows, a recorded run pid that is not a multiple of 4 is now reported dead instead of probing a neighbouring process, so abandoned runs read as orphaned rather than live.
