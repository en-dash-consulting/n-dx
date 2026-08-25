---
"@n-dx/llm-client": patch
---

Ctrl-C now reaches commands run through `exec()`. Tree-kill puts POSIX children in their own process group so a timeout can reach grandchildren, which also took them out of the group the terminal signals — so an interrupt no longer stopped them, and hench's `run_command` and `git` tools had to be killed by hand. While a detached child is alive, a SIGINT arriving at the parent is now forwarded to the child's group. One shared listener regardless of how many commands are in flight, removed as soon as the last child settles, and it stands down and re-raises when nothing else is listening so a CLI never ends up ignoring Ctrl-C. Windows is unchanged — it never detaches for tree-kill.
