---
"@n-dx/llm-client": patch
"@n-dx/web": patch
"@n-dx/core": patch
---

Resolve the legacy top-level `claude.*` keys against `llm.claude.*` **per
field**, and stop writing the legacy copies.

**Behaviour change.** A project carrying both an `llm.claude` block and legacy
`claude.*` keys now honours each legacy field the new block leaves unset. The
fallback used to be block-level (`llmClaude ?? legacyClaude`), so a modern block
holding a single field discarded every legacy field beside it — a project that
set `claude.api_key` once and later pinned `llm.claude.model` silently lost the
key, and `claude.lightModel` silently reverted to the tier default. Nothing said
so, because both states are valid config.

`resolveClaudeConfig` in `@n-dx/llm-client` is the one implementation of that
rule, exported alongside a `sources` map saying where each resolved field came
from. `loadLLMConfig`, `GET /api/llm/config` and `GET /api/ndx-config` all use
it, so the CLI, the dashboard and the footer can no longer disagree about which
value is live.

Two further consequences of reading the resolved view:

- The dashboard footer's auth check (`GET /api/ndx-config`) now counts a
  credential set under `llm.claude.api_key` / `llm.claude.cli_path`. It read
  only the legacy block before, and reported `authMethod: "none"` for a
  perfectly configured project — it happened to work solely because
  `packages/core/config.js` mirrored modern writes back into the legacy keys.
- That mirror is gone. `ndx config llm.claude.<field>` now writes only
  `llm.claude.<field>`. Existing `claude.*` values are deliberately left where
  they are: they are still read until 1.0.0, so rewriting or removing them would
  change what a project resolves without being asked to. The local-file
  migration still clears a legacy *secret* from the shared file, because a key
  mirrored there by an older version must not stay committed.

Writes go to the modern keys only. `PUT /api/llm/config` refuses `claude.model`
and `claude.lightModel` with a 400 naming the `llm.claude.*` replacement, rather
than the generic unknown-path error those keys would otherwise get.

`GET /api/ndx-config` also stops falling back to `hench.model` for the displayed
model. `ndx work` has never read that key, so the footer could name a model
nothing would run.

One sharp edge worth stating: a legacy `claude.model` that is incompatible with
the active vendor was previously masked whenever any `llm.claude` block existed,
and is now resolved — so `ndx work` reports it with the same actionable error a
bad `llm.claude.model` already gets, instead of silently running the default.
