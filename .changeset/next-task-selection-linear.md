---
"@n-dx/rex": patch
"@n-dx/web": patch
---

Next-task selection no longer goes quadratic in PRD size, which had made the dashboard unresponsive on a large PRD. rex's ranking scored every item through `collectRequirements`, which re-finds the item with a full tree walk, so one `findNextTask` cost about half a second on a 2,800-item tree; it now traces requirements from the entry it already holds. The dashboard's Live monitor, which ranks the next five tasks every two seconds, also keeps each ranking per parsed PRD and excluded set instead of recomputing it every tick, so a tick that changes nothing costs nothing.
