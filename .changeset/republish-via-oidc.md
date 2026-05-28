---
"@n-dx/core": patch
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Republish via npm Trusted Publishing. 0.4.2 was bumped in source but never
made it to the registry because the original NPM_TOKEN-based publish in
the Release run for #227 returned E404. Workflow now uses OIDC; this
changeset moves all six packages to 0.4.3 so they get published with
provenance attestation.
