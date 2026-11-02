---
"@n-dx/llm-client": patch
"@n-dx/core": patch
"@n-dx/hench": patch
---

A stored credential can be a password-manager command instead of a value: `ndx config credentials.<name> --helper "op read op://vault/item/field"`. The command is split with shell-style quoting and no expansion; `|`, `;`, `&`, `>`, `<`, `$(` and backticks are refused. When the key is needed, n-dx runs it without a shell, with stdin closed and a 10 s timeout, at most once per process. Its one line of output is the value. A failing helper counts as no key, with one warning that names the command and never its output. `ndx config credentials` names each helper without running it; `--check` runs them. hench's guard refuses `security find-generic-password` and every configured helper's command even when `guard.allowedCommands` lists them, and Claude CLI runs deny them as `Bash(<command>:*)` rules. An allowed interpreter such as `node -e` can still read the store or run a helper.
