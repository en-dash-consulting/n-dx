---
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/rex": patch
---

The `N-DX-Item` commit trailer now carries the PRD item id rather than a dashboard permalink. The permalink was built from `web.publicUrl`, defaulting to `http://localhost:3117`, so every autonomous commit wrote the author's host into permanent history and resolved to nothing on any other machine; `web.publicUrl` no longer affects the trailer. Readers accept both forms — `itemIdFromTrailer` unwraps a permalink of any host to the same id — so commits written before this change keep attributing.
