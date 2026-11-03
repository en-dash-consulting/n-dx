---
"@n-dx/core": patch
---

`ndx config llm.<vendor>.api_key <value>` (and the legacy `claude.api_key`)
now writes the per-user credential store instead of `.n-dx.local.json`, and
prints no value. Where `llm.<vendor>.auth` is unset in that checkout (claude
and codex) it also writes `llm.<vendor>.auth api` to `.n-dx.local.json` and
says so, so the key keeps switching that checkout to API mode; an explicit
`auth`, `cli` included, is never overwritten. An older copy of the key in a
config file is removed once the store write succeeds. With no value the key
shows its source and fingerprint, never the value.

`ndx config credentials` finds API keys already in `.n-dx.local.json`: on a
terminal it offers to move them, `--import` moves them without a prompt, and
otherwise it names the flag. A key leaves the file only after the store write
succeeds, and the same `auth` rule applies per vendor.

Soft freeze: this is a behaviour change to an existing `ndx config` key.
`llm.<vendor>.api_key` no longer reads back the value, and a key no longer
lands in `.n-dx.local.json`; existing keys in that file keep working until
moved, and `--import` is a new `ndx config` flag. No MCP tool changes shape.
