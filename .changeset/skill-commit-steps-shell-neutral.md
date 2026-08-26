---
"@n-dx/core": patch
---

Skill commit steps no longer prescribe a POSIX-only heredoc.

Five skill bodies (`ndx-adversarial-review`, `ndx-capture`, `ndx-config`, `ndx-plan`, `ndx-reshape`) built their commit message with `git commit -m "$(cat <<'EOF' … )"` — a construct that does not exist in PowerShell or cmd.exe, and Git Bash is not part of Windows (it arrives with Git for Windows, whose `usr/bin` is not on PATH outside Git Bash itself). The failure landed at the skill's LAST step, after all real work was written; worse, an assistant improvising around the parse error could drop the `Co-Authored-By` trailer, which fails silently — the commit lands but vanishes from the dashboard's merge graph.

The bodies now instruct the assistant to write the message with its file-writing tool to a scratch file and run `git commit -F <file>` — no shell quoting anywhere, so the trailer bytes survive in every shell. Repeated `-m` flags are explicitly named as unsafe (git's blank-line joining splits the trailer block). `tests/e2e/skill-portability.test.js` now rejects `cat <<` and `$(cat` in any skill body, so a sixth copy cannot creep in.
