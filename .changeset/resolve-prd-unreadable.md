---
"@n-dx/hench": patch
---

`ndx work --resolve` reports an unreadable PRD as a `prd-unreadable` refusal with `task: null` and exits 0, instead of exiting 1 with no JSON, so the dashboard can show the reason.
