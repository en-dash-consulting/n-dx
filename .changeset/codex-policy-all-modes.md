---
"@n-dx/llm-client": patch
---

`n-dx work` rejects Codex sandbox policies with network or writable-root settings that the selected mode cannot honor.

Action needed: use `workspace-write` for bounded writes and network controls. Read-only policies require network access disabled; full-access policies cannot carry network denial or bounded writable roots.

Strict configuration validation now applies to every sandbox mode and continuation. An installed CLI that rejects the required flag fails without retrying with weaker controls. Command allowlists and read-path guards remain unsupported by general native Codex execution.

The hub `Sidecar` uses a separate confined profile for audited macOS Codex CLI 0.167.0-alpha.3.2 (experimental, off by default; enable with `web.sidecar`). This admission does not extend its read confinement to general native Hench runs. Other hub platforms, versions and unavailable executables are refused.
