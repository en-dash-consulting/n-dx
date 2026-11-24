---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

`n-dx work` gives Codex execution and review processes private writable temporary directories, including resumed and forked sessions.

Normal temporary-file APIs use the private directory through `TMPDIR`, `TMP` and `TEMP`. Each spawn removes its directory after exit, including failure and cancellation. Host temporary directories stay excluded and network permissions stay unchanged.
