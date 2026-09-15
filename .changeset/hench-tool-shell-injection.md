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
  `node -e "console.log('x')"` that the old blunt regex could catch. `run_command`
  still executes through the shell, which Windows `.cmd` shims (`npm`, `npx`,
  `vitest`, `tsc`) require.

Reproduced against built code before and after. Found by the 2026-09-11
adversarial security review (findings C and D).
