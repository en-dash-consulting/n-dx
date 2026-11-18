---
"@n-dx/hench": patch
---

`n-dx work --resolve` and the dashboard preparation dialog now identify command, Git-subcommand and blocked-path controls that Codex CLI does not enforce.

The same notice appears in run output and saved diagnostics. No vendor or provider is switched automatically. Direct OpenAI API runs retain Hench's tool guards; Codex hub sessions remain unavailable because their read confinement is not proven.
