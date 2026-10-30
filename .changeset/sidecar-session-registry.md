---
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

A vendor session started without an explicit `env` now gets the parent environment filtered by `resolveVendorCliEnv` (with optional `envPolicy` and `llmConfig`), never the full `process.env`; `addTokenUsage` is exported. The web server gains a Sidecar session registry (not yet routed): sessions keyed by scope and worktree, persisted to `.hench/sidecar/index.json` so they resume by vendor id after a restart, forgetting the id after a 2-hour idle TTL, with JSONL transcripts in a self-ignoring directory.
