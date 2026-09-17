---
"@n-dx/web": minor
---

Workspace registry: the server is anchored at the directory it was started in and holds one `ServerContext`, watcher set and PRD cache per worktree of the repository (`src/server/workspaces.ts`). The anchor is set up eagerly exactly as before; any other worktree is created lazily the first time a request addresses it — via the `X-Ndx-Workspace` header or the `/w/<key>/` slot — and falls back to the anchor otherwise, so nothing observable changes for a single-worktree server. Keys are worktree basenames (`main` aliases the anchor); the list refreshes from `git worktree list` every 30 s and on `POST /api/workspaces/refresh`, releasing the resources of a worktree that disappeared (never the anchor). `GET /api/workspaces` lists them.
