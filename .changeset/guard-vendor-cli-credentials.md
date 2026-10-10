---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

Filter credential-shaped environment variables before launching vendor CLIs,
including retries and cross-vendor reviewers, while retaining the active
vendor's authentication, including Claude's active Bedrock and Vertex modes.
An explicit `hench.guard.env.allow` entry permits the matching variables to
reach children; projects that need additional credentials for tests or MCP
servers must opt in there.
