---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Make refusal recovery commands safe to paste into cmd.exe and PowerShell, not just POSIX shells. A path outside the shell-inert charset no longer rides inline with POSIX single-quoting (literal characters to cmd.exe — `&` still split the command, spaces still separated, and `%VAR%` expansion cannot be escaped interactively): the paths are written to `.hench/recovery/pathspec*.txt` and the suggested commands use `git … --pathspec-from-file`, so the copyable line contains no arbitrary text for any shell to expand or split. The POSIX-quoted form survives only as a fallback when the pathspec file cannot be written, now carrying an explicit "POSIX shells only" caveat. `.hench/recovery/` is declared a hench runtime artifact (gitignored by `hench init`, discounted by the gates) and added to the `ndx init` ignore template. Covered by execution tests that run the emitted commands through real cmd.exe, PowerShell, and sh against hostile filenames (spaces, `&`, `%`, `$`, backticks, embedded single quotes).
