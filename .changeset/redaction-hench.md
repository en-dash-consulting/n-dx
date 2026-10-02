---
"@n-dx/hench": patch
---

Run records and run logs are scrubbed of credential-shaped text before they are written. A tool that prints a `.env`, a bearer header or a connection string no longer leaves the secret in `.hench/runs/` or `.run-logs/`; the in-memory record the agent works from is unchanged. The scrub covers the live `.run-logs/` writer as well as the end-of-run one — the live file is the one a real run produces — and both share a stateful redactor, so a private key split across lines is caught and the two writers still produce byte-identical files.
