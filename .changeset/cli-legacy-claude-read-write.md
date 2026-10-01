---
"@n-dx/core": patch
---

`ndx config claude.<field>` now writes `llm.claude.<field>` (printing a one-line
deprecation note on stderr naming the key actually written), and every CLI read
path — the single-key get, the whole-section get, `--json`, and
`--test-connection` — resolves `llm.claude.<field>` over the legacy
`claude.<field>` per field, via `resolveClaudeConfig` (`@n-dx/llm-client`).

Before this, `ndx config claude.model` answered `Key "claude.model" not found.`
right after setting it, `ndx config claude` and `ndx config --json` showed only
the legacy section, and a project configured entirely under `llm.claude.*`
could look unconfigured to these read paths. Existing `claude.*` values on disk
are left in place — only where new writes land has changed.

The hand-written `resolveClaudeSettings` duplicate in `packages/core/config.js`
is gone; it now delegates to `resolveClaudeConfig`, loaded the same way
`config.js` already loads other `@n-dx/llm-client` helpers (`await import(...)`
— `config.js` may not statically import packages).
