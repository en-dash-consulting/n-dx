---
"@n-dx/web": patch
---

The sidebar footer now shows which n-dx is running: `n-dx <version> · <install> · <project>`, with the full CLI and project paths in its tooltip. It reads the `server` object that `GET /api/config` already returns and that the viewer already fetches before its first render, so there is no extra request, and it renders on every view without waiting for the configuration panel's own fetch. A server too old to send the object renders no identity line.
