---
"@n-dx/core": patch
"@n-dx/web": patch
---

`ndx start` names a server older than itself instead of printing a URL with no sign-in link. `/api/hub/health` reports the hub's build (`build: { version, sourceHash }`), and `ndx start` warns when a reused hub runs another build. A source-linked install also warns before spawning when `packages/web/dist` is older than its source (a `pnpm dev` watch build does not count as stale). A missing nonce route now reads "the server is older than this ndx" with a fix that works: `pnpm --filter "@n-dx/web..." build` comes first when the `dist/` on disk is stale, because a restart alone would spawn it again, and the restart names the server's own commands (`--here`, `--preview`, `ndx web`). `ndx start status` in a directory with no recorded registration says this user's hub is running and names the command that registers it, rather than "No background server recorded" and "Port 3117 is in use by another process".
