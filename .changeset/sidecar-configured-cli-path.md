---
"@n-dx/llm-client": patch
"@n-dx/web": patch
"@n-dx/hench": patch
---

(experimental, off by default; enable with `web.sidecar`) Sidecar uses the trusted vendor CLI path for fresh and resumed sessions and explains missing binaries.

Local overrides and PATH discovery remain supported. Missing-binary errors identify the setting to repair.
