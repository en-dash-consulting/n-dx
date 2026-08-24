---
"@n-dx/llm-client": patch
"@n-dx/sourcevision": patch
"@n-dx/core": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
"@n-dx/web": patch
---

Update LLM model catalogs to current vendor releases

Refreshes the Claude, Codex, and Gemini model catalogs and fixes several
incorrect context-window and pricing entries. Two of the previous defaults
pointed at models that are no longer usable.

**Claude**
- `claude-opus-4-8` → `claude-opus-5` in the init catalog, the `opus` shorthand
  alias, and the `heavy` tier (was `claude-opus-4-7`).
- Added a `fable` shorthand alias for `claude-fable-5`.
- Corrected context windows: `claude-sonnet-4-6` and `claude-opus-4-7` are 1M
  models, not 200K.
- Corrected pricing: `claude-haiku-4-5` is $1.00/$5.00 (was $0.80/$4.00) and
  `claude-opus-4-7` is $5.00/$25.00 (was $15.00/$75.00).
- Default remains `claude-sonnet-5`.

**Codex** — GPT-5.6 replaces the GPT-5.4/5.5 line
- Default is now `gpt-5.6-terra` (was `gpt-5.5`), with `gpt-5.6-sol` as a new
  `heavy` tier (codex previously had no tier above standard) and `gpt-5.6-luna`
  as `light` (was `gpt-5.4-mini`).
- `gpt-5.4` and `gpt-5.4-mini` retire from ChatGPT-authenticated Codex sessions
  on 2026-08-31; `gpt-5.3-codex` and `gpt-5.2` are already unavailable there.
  All four are now legacy aliases that normalize to OpenAI's stated
  replacements, so existing `.n-dx.json` files keep working after upgrade.
- `gpt-5.5` is still supported and remains a selectable catalog entry.
- `openai-api-provider` default was `gpt-4o`; now `gpt-5.6-terra`.

**Google**
- `gemini-2.0-flash` has been **shut down** by Google and was the configured
  `light` tier — replaced with `gemini-3.5-flash-lite`. `standard` moves from
  `gemini-2.5-flash` to `gemini-3.7-flash`.
- `heavy` intentionally stays on `gemini-2.5-pro`, the newest *stable* Pro
  model. `gemini-3.1-pro-preview` is newer but is a preview release whose ID
  may be renamed or withdrawn; it remains selectable via `llm.google.model`.
- Corrected `gemini-2.5-flash` pricing to $0.30/$2.50 (was $0.15/$0.60).

Also refreshes the dashboard's model suggestions, which still listed retired
IDs (`claude-haiku-3-5`, `claude-3-7-sonnet-20250219`, `o3`, `o4-mini`), and
updates model examples in `ndx config --help`, `ndx init --help`, and the
configuration guide.
