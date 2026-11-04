---
"@n-dx/llm-client": patch
---

When n-dx gives the Claude CLI an API key itself (`llm.claude.auth api` with a key from config, the environment, the credential store or a helper, or a configured key under `auto`), it also sets `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, so commands the agent runs through Claude Code no longer inherit `ANTHROPIC_API_KEY`. The CLI still authenticates with the key.
