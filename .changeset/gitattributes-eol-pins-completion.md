---
"@n-dx/core": patch
---

Complete the `.gitattributes` LF-pin coverage (follow-up to #283/#285). Three n-dx-written surfaces were writing LF but had no eol pin, so Windows checkouts (`core.autocrlf=true`) showed line-ending-only churn on every tool write:

- `.claude/skills/**/*.md` — generated Claude skills (now committed per #284)
- `.codex/config.toml` — generated Codex MCP config
- `.sourcevision/**/*.txt` — sourcevision text output (e.g. `llms.txt`)

All three are added to both `GITATTRIBUTES_EOL_RULES` (the list `ndx init` injects into a project's `.gitattributes`) and n-dx's own `.gitattributes`, keeping the two in sync per the stated invariant. `cli-init.test.js` and `prd-line-endings.test.js` now assert the new patterns so the coverage can't silently regress.
