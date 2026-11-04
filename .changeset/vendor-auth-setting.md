---
"@n-dx/llm-client": patch
"@n-dx/core": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

New `llm.<vendor>.auth` setting (`cli`, `api` or `auto`, default `auto`)
chooses which credential claude, codex and google get. `ndx config
credentials.claude|codex|google` stores a vendor key in the per-user
credential store. A stored key is used under `api` (and by google, which has
no CLI login); under `auto` only a configured or exported key selects the API,
so storing a key never moves a vendor off its CLI login. `cli` keeps the vendor
key out of the CLI child. `ndx config credentials [dir]` prints each vendor's
mode and key source, never a value. hench refuses `provider=api` under `auth
cli`, or with no key it may use, before the run starts; `ndx work --resolve`
reports `auth`. A project config's `llm.<vendor>.auth api` applies only once
the repository is trusted.

Soft freeze: `llm.<vendor>.auth` and `credentials.<vendor>` are new keys, and
`--resolve` gains a top-level `auth` field. With no stored vendor key and no
`auth` set, every mode choice and child environment is unchanged. The missing
API key errors now name `ndx config credentials.<vendor>` and
`llm.<vendor>.auth`. No MCP tool changes shape.
