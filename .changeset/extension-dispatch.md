---
"@n-dx/core": patch
---

`ndx <name>` now runs an enabled extension's command when no built-in owns the name. The command's `bin` runs on n-dx's own Node with the remaining arguments and inherited stdio, sharing the terminal so Ctrl+C reaches it directly. SIGTERM, and on POSIX SIGHUP, sent to `ndx` are passed on to it, and its exit code becomes `ndx`'s. Built-in commands always win. An unapproved extension, or one whose `bin` is missing, exits 2 with one line naming the fix. A disabled or incompatible extension's name still reports "Unknown command", now with a hint saying why it can't run.
