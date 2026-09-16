---
"@n-dx/hench": patch
---

Close two shell-injection holes in hench's agent-facing tools.

Both let repo content driving an autonomous run (via prompt injection) escape
the command allowlist in API/local-model provider mode:

- **`git` tool** tokenized its `args`, re-joined them into a string, and ran it
  through `sh -c` — never calling the command guard. `args: "\"--short; echo
  pwned > f\""` executed the echo+redirect. It now spawns `git` with an explicit
  argv and no shell, so every arg reaches git as literal bytes; git is a real
  binary, so this is Windows-safe. New `execArgv` in `tools/exec-shell.ts` shares
  the result formatting with `execShell`.

- **`run_command` guard** blocked only `[;&|` + "`" + `$]`, missing newlines and
  redirection: `"npm --version\nrm -rf ~"` and `"npm test > ~/.bashrc"` both got
  through and `sh -c` ran the second command. The guard now scans quote-aware —
  reporting `; & | ` + "`" + ` $ < > ( )` only when unquoted, and any raw newline
  — so it also stops *over*-rejecting legitimate quoted arguments like
  `node -e "console.log('x')"` that the old blunt regex could catch. Double
  quotes are not a blanket pass: `sh` still expands `$(…)`, `${…}` and
  backticks there, so `$` and backtick are rejected inside double quotes too
  (`node -e "$(curl … | sh)"` no longer reaches the shell) — only single quotes
  are wholly literal, and a backslash-escaped `\$` stays allowed. `run_command`
  still executes through the shell, which Windows `.cmd` shims (`npm`, `npx`,
  `vitest`, `tsc`) require — and the guard now models the shell that will
  actually run it. On a Windows host with no `sh`, `execShellCmd` falls back to
  cmd.exe, where a single quote is an ordinary character and `\"` is not an
  escape, so `npm test 'x & del /q y'` was one argument to the POSIX model and
  two commands to cmd.exe. `GuardRails` resolves the shell kind once per run
  from the same `resolveShellKind` the executor uses, and under cmd.exe the
  scan rejects `& | < > ( ) ^` outside double quotes and `%` anywhere.

Reproduced against built code before and after. Found by the 2026-09-11
adversarial security review (findings C and D).
