---
"@n-dx/web": patch
---

A refused Sidecar start now reports hench's refusal and its file list even when hench also printed a warning: the failure text and the execution log carry the end of stderr, then the end of stdout.
