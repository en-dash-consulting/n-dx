---
"@n-dx/core": patch
---

`ndx init` now writes (or merges into) the target project's `.gitattributes`, pinning every n-dx-written tracked file (`.rex/`, `.hench/`, `.sourcevision/`, `.n-dx.json`, `AGENTS.md`, `CLAUDE.md`, `.agents/`) to `text eol=lf`. This stops Windows checkouts (`core.autocrlf=true`) from showing spurious line-ending-only modifications after every tool write. Existing `.gitattributes` content is preserved and user rules for overlapping patterns win; re-running `ndx init` is idempotent.
