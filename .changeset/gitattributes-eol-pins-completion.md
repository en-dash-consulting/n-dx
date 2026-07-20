---
"@n-dx/core": patch
---

Complete the `.gitattributes` LF-pin coverage (follow-up to #283/#285). Three n-dx-written surfaces were writing LF but had no eol pin, so Windows checkouts (`core.autocrlf=true`) showed line-ending-only churn on every tool write:

- `.claude/skills/**/*.md` — generated Claude skills (now committed per #284)
- `.codex/config.toml` — generated Codex MCP config
- `.sourcevision/**/*.txt` — sourcevision text output (e.g. `llms.txt`)

All three are added to both `GITATTRIBUTES_EOL_RULES` (the list `ndx init` injects into a project's `.gitattributes`) and n-dx's own `.gitattributes`, keeping the two in sync per the stated invariant.

The root cause of the pins shipping incomplete was that these two sources drifted apart — one updated, the other not — and no test caught it. To close that class of bug for good:

- The rules are extracted into a single importable source of truth (`packages/core/gitattributes-pins.js`), imported by `cli.js`.
- A **sync-guard test** (`prd-line-endings.test.js`) asserts the injector's pattern set equals n-dx's own `.gitattributes` `eol=lf` pattern set — any future divergence fails CI, not just the three patterns fixed today. `cli-init.test.js` also asserts the new patterns are injected.
