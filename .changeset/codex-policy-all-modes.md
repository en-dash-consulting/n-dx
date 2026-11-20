---
"@n-dx/llm-client": patch
---

`n-dx work` rejects Codex sandbox policies with network or writable-root settings that the selected mode cannot honor.

Action needed: use `workspace-write` for bounded writes and network controls. Read-only policies require network access disabled; full-access policies cannot carry network denial or bounded writable roots.

Strict configuration validation now applies to every sandbox mode and continuation. An installed CLI that rejects the required flag fails without retrying with weaker controls. Command allowlists and read-path guards remain unsupported by native Codex execution; hub sessions remain refused.
