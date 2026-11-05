---
"@n-dx/web": patch
---

Settings > Connections no longer waits the connect timeout on every load while a connection's server hangs; a failed connection is not retried inside its retry interval.
