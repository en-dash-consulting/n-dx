---
"@n-dx/core": patch
"@n-dx/web": patch
---

`ndx start` names a server older than itself instead of printing a URL with no sign-in link. `/api/hub/health` reports the hub's build (`build: { version, sourceHash }`), and `ndx start` warns when a reused hub runs another build. A source-linked install also warns before spawning when `packages/web/dist` is not a build of its current source. A missing nonce route now reads "the server is older than this ndx" with a fix that works: the rebuild comes first when the `dist/` on disk is stale, because a restart alone would spawn it again. `ndx start status` in an unregistered directory says this user's hub is running and the directory is not registered with it, rather than "No background server recorded" and "Port 3117 is in use by another process".
