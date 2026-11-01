---
"@n-dx/core": patch
---

`ndx config credentials` shows the per-user credential store (backend, source
in effect, fingerprint; never a value), and `ndx config credentials.typesafe`
stores the Jev key from a hidden prompt, `--stdin`, or argv (with a warning),
and `--unset` removes it. Other `credentials.<name>` are refused; vendor keys
come later.

Soft freeze: `credentials` and `credentials.typesafe` are new `ndx config`
keys, and `--stdin` and `--unset` are new `ndx config` flags. Every existing
`ndx config` key, `llm.<vendor>.api_key` included, behaves as before, and no
MCP tool changes shape.
