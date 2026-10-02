---
"@n-dx/web": patch
---

The run log route now returns the last bytes of a finished run's log even when they stop partway through a character. Those bytes show as U+FFFD and the response has `more: false`. Bytes that can never start a UTF-8 character are no longer held back.
