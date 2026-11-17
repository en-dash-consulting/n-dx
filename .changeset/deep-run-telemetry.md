---
"@n-dx/llm-client": patch
"@n-dx/sourcevision": patch
---

Claude CLI calls now record their token counts, so `ndx analyze` ledgers and run costs include Claude escalations and zone enrichment instead of showing 0 tokens.

The current Claude CLI prints one JSON result object with its counts nested under `usage`; only top-level counts used to be read. A TypeSafe cascade run that also reached a text model now writes the startup primer instead of skipping it as "cascade mode". When stdout isn't a terminal, analyze notes on stderr, even under `--quiet`, that background zone narration continues after it exits, with the log path and `--wait`.
