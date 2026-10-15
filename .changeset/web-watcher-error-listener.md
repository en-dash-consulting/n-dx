---
"@n-dx/web": patch
---

Keep `ndx start` alive when a dashboard file watcher errors

The sourcevision, rex, hench and dev-viewer watchers had no `error` listener, so an error emitted after `fs.watch` returned (Windows raises EPERM when a watched directory is deleted, for example on a branch switch) was an uncaught exception that crashed the server. Each watcher now logs a warning and closes itself; a failed rex PRD-folder watcher is dropped so the folder can be watched again.
