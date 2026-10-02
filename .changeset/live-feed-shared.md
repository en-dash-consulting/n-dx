---
"@n-dx/web": patch
---

The Live tab, bottom bar, running-now bar and Live overview now share one live feed: one fetch, one WebSocket and one poller, so leaving /live no longer stops the others updating. The socket reconnects with backoff after it closes.
