---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
"@n-dx/core": patch
---

Claude API requests now send `llm.effort` as `output_config.effort`, and Claude Opus 5.5 defaults to `high` effort. `llm.effort` was parsed but never sent. With no matching rule, `claude-opus-5-5` gets `high` so the move from Opus 5 keeps its reasoning depth (Opus 5.5's API default is `medium`), and other models are unchanged. Effort is never sent to a model that rejects it (Haiku 4.5, Sonnet 4.5 and older) or when the value is not `low`, `medium`, `high`, `xhigh` or `max`; both cases print a warning. Claude Code CLI runs are unchanged.
