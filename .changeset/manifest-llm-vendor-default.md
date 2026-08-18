---
"@n-dx/web": patch
---

The Commands reference no longer marks LLM commands "needs LLM" on projects without an explicit `llm.vendor`: the manifest now mirrors the CLI's own default (absent vendor resolves to claude), so plan/recommend/add/work/self-heal/pair-programming show as available on any initialized project.
