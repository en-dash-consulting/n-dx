---
"@n-dx/hench": patch
---

A failing file watch no longer kills `ndx work` before the agent starts. The commit-message watcher now falls back to its poll when `fs.watch` throws or emits an error (such as EMFILE), instead of letting Node rethrow the unhandled `'error'` event. With `hench.commitMsgTimeoutMs` at its default of 0 the watcher opens no watch at all, since it could never act.
