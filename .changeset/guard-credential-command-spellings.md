---
"@n-dx/hench": patch
---

hench's guard refuses `security find-generic-password` behind a global option (`security -q find-generic-password`) or a shell escape (`find\-generic-password`), even with `security` in `guard.allowedCommands`. Other `security` subcommands still pass. The Claude CLI's prefix deny rules cannot match those spellings; the configuration guide names the gap.
