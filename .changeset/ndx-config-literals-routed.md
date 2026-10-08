---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
"@n-dx/web": patch
---

Every remaining reader of the project config asks the layout resolver where it lives, so a project on the `.ndx/` layout is read from `.ndx/config.json` (and `.ndx/config.local.json`) instead of a root `.n-dx.json` nothing writes. In `@n-dx/llm-client` that is `loadLLMConfig`, `loadClaudeConfig`, `loadProjectOverrides` and `loadProjectOverrideSources`, whose `file` label is now the root-relative path of the file read; `PROJECT_CONFIG_FILE` and `LOCAL_CONFIG_FILE` keep their legacy names for labels. In `@n-dx/hench`: the project CLI name, the Claude weekly budget, archival and retention settings and `hench.fullTestCommand`. In `@n-dx/web`: the config, LLM, features, CLI-timeout, project-settings, SourceVision (zone pins and Ask timeout), token-usage and usage-cleanup routes, the CLI name, and the dashboard usage ledger, which lands at `.ndx/web-usage.jsonl` on that layout; `GET /api/cli/timeouts` now reports `configFile`, the file the overrides live in, and the CLI Timeouts page shows it. The layout-literal inventory reaches zero.

The same sweep found that hench and rex recovered the project root from their own state directory as its parent, which on the `.ndx/` layout is the container — so `loadConfig`'s project overrides and the `loadClaudeConfig` / `loadLLMConfig` adapters read `.ndx/.n-dx.json`, a file nothing writes, and every override was silently ignored on a migrated project. `projectRootOf` in `@n-dx/llm-client` (exported, and through hench's llm gateway) steps over the container, and `loadProjectOverrideSources` and both packages' adapters use it.
