---
"@n-dx/web": patch
---

Commands reference rows gain inline Run buttons for dashboard-triggerable commands: the manifest now declares each command's trigger endpoint (and status endpoint for async runs), and rows show live running state plus a last-run outcome without a page reload. Commands without trigger support stay read-only with their resolved CLI invocation.
