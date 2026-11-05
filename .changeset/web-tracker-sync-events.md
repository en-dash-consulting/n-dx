---
"@n-dx/web": patch
---

Tracker sync collects its events at each tick: a hench run starting a linked task, a PR carrying an `N-DX-Item` trailer opened or merged (gh, only while `web.sidecarGithubReads` is on), a release tag for a change's `shippedIn`, and a task's second failed run in a row. Each source keeps a cursor in `<henchDir>/sidecar/tracker-cursors.json`, so an event is queued once and a restarted server does not queue it again; the first read is a baseline. The hub ticks every project whose `.n-dx.local.json` sets a rule not off, on its server's start and every five minutes, through its proxy with the per-user token, and skips a server that is not healthy.
