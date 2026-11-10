---
"@n-dx/llm-client": patch
---

A credential write no longer fails, and no longer leaves the store locked under its own PID, when Windows refuses to delete the lock's temporary file (an antivirus scanner or the indexer holding it open). The temp file is removed later instead.
