---
"@n-dx/web": patch
---

Add `GET /api/workspaces/:key/prd-delta`: how a worktree's PRD differs from the anchor's, computed server-side by item id — `onlyHere`, `onlyAnchor`, `changed` (status, title, priority, description or lastModified differ) and `completedHere` — with exact counts, id lists capped at 500 (`truncated` flag), and `identical` for trees that match. Cached per (anchor, workspace) pair and invalidated by either tree's rex watcher.
