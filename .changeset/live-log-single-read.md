---
"@n-dx/web": patch
---

The Live Log tab no longer shows lines twice when a log read takes longer than its 500 ms poll: only one read is in flight at a time, and a tick that lands mid-read schedules one follow-up. A log that ends inside a multi-byte character no longer makes the tab re-request the same offset in a tight loop.
