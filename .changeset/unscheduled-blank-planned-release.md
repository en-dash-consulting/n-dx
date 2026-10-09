---
"@n-dx/web": patch
---

The Changes view now treats a blank or whitespace-only `plannedRelease` as unscheduled instead of rendering it under a nameless release heading, and trims surrounding whitespace when bucketing, so `2.1.0` and ` 2.1.0 ` group as one release.
