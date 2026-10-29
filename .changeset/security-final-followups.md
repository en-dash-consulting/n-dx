---
"@n-dx/llm-client": patch
"@n-dx/core": patch
"@n-dx/hench": patch
---

Strip additional credential variable names from child environments, including PAT, key, password, JWT, DSN, session, webhook and database URL names. Named directory and desktop session plumbing still passes. Tools that require a newly filtered variable must list it in a trusted `hench.guard.env.allow` policy. An exact user deny now takes precedence over plumbing exceptions.

Keep valid user environment denies when a repository policy field is malformed. Refuse credential writes to tracked or unclassifiable local config, warn for other local writes, classify CI's local-config checks through the existing trust classifier, and explain skipped Claude settings when git cannot answer without printing the configured binary.
