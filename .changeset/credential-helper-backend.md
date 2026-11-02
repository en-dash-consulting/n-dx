---
"@n-dx/llm-client": patch
"@n-dx/core": patch
"@n-dx/hench": patch
---

A stored credential can be a password-manager command instead of a value: `ndx config credentials.<name> --helper "op read op://vault/item/field"`. The command is split with shell-style quoting and no expansion; `|`, `;`, `&`, `>`, `<`, `$(` and backticks are refused. When the key is needed, n-dx runs it without a shell, with stdin closed and a 10 s timeout. Its one line of output is the value, kept for the process. A failing helper counts as no key and is run again after 60 s, so a long-running hub picks the key up once the password manager is unlocked; one warning per failure streak names the command and never its output. `ndx config credentials` names each helper without running it; `--check` runs them. hench's guard refuses `security find-generic-password` and every configured helper's command even when `guard.allowedCommands` lists them, and Claude CLI runs deny them as `Bash(<command>:*)` rules, plus the double- and single-quoted spellings when a path in the command holds a space. For an interpreter helper (`node get-key.mjs`) the denied prefix runs through the script, so agents may still run `node` itself; an interpreter with inline code or no script (`bash -c`, `node -e`) is refused at `--helper` time. An allowed interpreter such as `node -e` can still read the store or run a helper.
