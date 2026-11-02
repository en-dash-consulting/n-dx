---
"@n-dx/hench": patch
---

Let the sandboxed Claude CLI read its login from the macOS login keychain, so a sandboxed session is no longer reported as not logged in. The keychain directory is readable and never writable from the sandbox; `securityd` still answers the CLI and its Bash children, so an item whose access list trusts `/usr/bin/security` remains readable (see SECURITY.md).
