---
"@n-dx/web": patch
---

Start a branch refuses branch names with shell metacharacters (`INVALID_NAME`) and prefills only `[A-Za-z0-9._/-]` from a change slug, so the pasted `git switch` command cannot run extra commands.
