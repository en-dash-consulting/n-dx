---
"@n-dx/core": minor
---

Vendor-neutral assistant integration layer for ndx init

- Add assistant-integration orchestration that provisions Claude and Codex surfaces independently of the active LLM vendor
- Add init-llm module with interactive provider/model selection via enquirer (flag > config > prompt precedence)
- Add vendor-specific model flags (--claude-model, --codex-model) that persist independently
- Fix MCP server re-registration: remove before re-add so ndx init is idempotent
- Surface MCP registration error details in init summary instead of silent failures
- Integrate child-lifecycle process tracking and signal handlers from main
- Add machine-local config support (.n-dx.local.json) for CLI paths and other per-machine settings
