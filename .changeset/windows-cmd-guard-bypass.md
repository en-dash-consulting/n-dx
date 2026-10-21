---
"@n-dx/core": patch
"@n-dx/llm-client": patch
"@n-dx/sourcevision": patch
---

The Windows spawn guard now refuses what cmd.exe would actually expand. #790 refused a `%NAME%` token only when `NAME` was in the environment, but cmd.exe also expands variables it computes itself (`%CD%`, `%RANDOM%`, `%CMDCMDLINE%`, …) and reads the name before a `:~` or `:a=b` modifier, so `%CMDCMDLINE:~-1%` slipped through and expanded to a bare `"` that ended the argument. A token carrying a line break is refused too, since cmd.exe silently drops everything after it. Every cmd.exe invocation passes `/v:off`, and sourcevision's `execFileSyncCli` is llm-client's, so there is one recipe.
