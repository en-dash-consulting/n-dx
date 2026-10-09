---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

Filter credential-shaped environment variables before launching vendor CLIs,
including retries and cross-vendor reviewers, while retaining the active
vendor's authentication. Projects that need additional credentials for tests
or MCP servers must explicitly list them in `hench.guard.env.allow`.
