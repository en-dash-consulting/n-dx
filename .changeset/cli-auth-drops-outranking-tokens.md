---
"@n-dx/llm-client": patch
---

Under `llm.<vendor>.auth cli`, and whenever n-dx sets the vendor key itself, the vendor CLI child no longer receives a token the CLI ranks above that key or its login: `ANTHROPIC_AUTH_TOKEN` for Claude, `CODEX_API_KEY` for Codex, in any casing. Login plumbing and Bedrock and Vertex credentials are unchanged.
