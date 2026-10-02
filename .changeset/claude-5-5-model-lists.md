---
"@n-dx/llm-client": patch
"@n-dx/core": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Add Claude Opus 5.5, Sonnet 5.5 and Fable 5.1, and move the Claude defaults onto them

**The defaults have changed.** The standard tier (and the default when no model is
configured) is now `claude-sonnet-5-5`. The heavy tier and the review model are now
`claude-opus-5-5`. The `opus` alias now resolves to `claude-opus-5-5` and `fable`
to `claude-fable-5-1`. `ndx init` offers Sonnet 5.5 (recommended), Opus 5.5,
Fable 5.1 and Haiku 4.5.

All three new models have a 1M context window and list pricing, so budget
preflight, `ndx usage` and the dashboard spend views price them as known. That
includes dated `-YYYYMMDD` snapshots. Previously they fell back to estimated
rates and showed `known: false`.

`claude-sonnet-5`, `claude-opus-5` and `claude-fable-5` are still priced and
resolvable, and `ndx init` accepts them without an unknown-model warning.

The dashboard config footer now shows every version part: `sonnet 5.5`,
`fable 5.1`, `haiku 4.5`. Before, it showed `sonnet 5` and `haiku 4`.

**Pinning back.** Older Claude Code releases can reject the new model ids on
CLI-provider runs. If yours does, upgrade Claude Code, or pin the previous model:
`ndx config llm.claude.model claude-sonnet-5 .`. For the heavy tier and review,
also set `llm.tiers.claude.heavy` and `llm.claude.reviewModel` to
`claude-opus-5`.
