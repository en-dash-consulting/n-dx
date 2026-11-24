---
"@n-dx/hench": patch
---

`n-dx work --resolve` and the dashboard preparation dialog now identify command, Git-subcommand and blocked-path controls that Codex CLI does not enforce.

The same notice appears in run output and saved diagnostics. No vendor or provider is switched automatically. Direct OpenAI API runs retain Hench's tool guards.

The hub `Sidecar` separately admits audited macOS Codex CLI 0.167.0-alpha.3.2 (experimental, off by default; enable with `web.sidecar`). Its confined profile does not add command, Git-subcommand, blocked-path or general read-path guards to native Hench runs. Other hub platforms, versions and unavailable executables are refused.
