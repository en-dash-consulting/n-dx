---
"@n-dx/hench": patch
---

Run records and run logs are scrubbed of credential-shaped text before they are written. A tool that prints a `.env`, a bearer header or a connection string no longer leaves the secret in `.hench/runs/` or `.run-logs/`; the in-memory record the agent works from is unchanged.
