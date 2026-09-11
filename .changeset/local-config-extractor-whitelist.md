---
"@n-dx/llm-client": patch
---

fix(llm-client): stop dropping documented llm.local settings at load time

`extractLocalConfig` whitelists keys, and it only copied `host`, `port`,
`model`, and `lightModel`. Every other documented `llm.local` setting —
`timeoutMs`, `maxContextTokens`, `reviewModel`, and the `verifier` block —
was silently discarded on load: operators set them in `.n-dx.json`, the
loader dropped them, and the local loop ran on its defaults with no error
anywhere. Notably this made `llm.local.timeoutMs` (the configurable request
timeout for slow local models) inert when set via config.

All documented `LocalConfig` fields now survive the load, including
`timeoutMs: 0` (wait indefinitely), which must not be dropped by a truthiness
check. The verifier block is validated field-by-field like the rest.
