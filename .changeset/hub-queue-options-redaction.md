---
"@n-dx/web": patch
---

The hub's queued 202 now echoes the accepted run options, as the project server's 202 does, and the viewer's `HubQueueEntry` carries `options`. `GET /api/hub/queue` no longer includes `contextNotes` text, scoped or not: entries keep their other options and gain `hasNotes: true`.
