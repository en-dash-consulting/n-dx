---
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

Raise the default `hench.maxTurns` from 50 to 200. The cap now also bounds Claude CLI sessions, where 50 cut off ordinary tasks; the named templates keep their own values.
