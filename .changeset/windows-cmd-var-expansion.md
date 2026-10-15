---
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

The Windows CLI spawn now refuses a command line that `cmd.exe` would rewrite before running it.

`quoteWindowsToken` neutralises every `cmd.exe` metacharacter except one, and said so in its own comment: `%VAR%` is expanded *inside* double quotes, and the substituted text is then parsed as part of the command line. An expanded value holding a double quote therefore ends the argument early, and an `&` after it starts a second command. `cmd.exe` offers no escape for `%` outside a batch file, so quoting cannot close this — the limitation was written down as a caller contract instead, with nothing enforcing it.

`spawnCli`, and the `spawnCli`/`execFileSyncCli` twins in `@n-dx/core`, now check the tokens against the environment they are about to pass and throw rather than spawn. The check is deliberately narrow: `cmd.exe` expands only a name it can resolve and leaves anything else literal, so a path that merely contains a percent sign (`C:\Users\100%cool\bin`) still spawns, and so does one naming a variable that is not set. Only a token that would actually be rewritten is refused, and no CLI the toolkit spawns passes one. Matching is case-insensitive, as Windows environment lookup is.

POSIX spawns are unaffected — they never go through `cmd.exe`.
