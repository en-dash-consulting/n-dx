---
"@n-dx/web": patch
---

The LLM catalog drops an unused `restricted` parameter and a "CLI not verified" readiness state nothing produced; the architecture docs now say what actually protects it (the trusted-config clamp on `cli_path`, and a model list that always calls the vendor's own URL).
