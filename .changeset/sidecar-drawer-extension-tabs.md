---
"@n-dx/web": patch
---

The Sidecar drawer shows an extension's page as a tab: Sidecar first, then one tab per extension in the hub's order, only when a hub lists any. A tab asks for its frame key on first open, loads in an iframe sandboxed with `allow-scripts allow-forms allow-popups allow-downloads`, shows "Starting …", the hub's 503 with its log file, or "Expired · Reload", and offers a pop-out link. Switching tabs keeps the conversation, the composer and the frame.
