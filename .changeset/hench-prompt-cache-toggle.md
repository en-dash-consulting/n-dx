---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Add `hench.promptCache` to disable Anthropic `cache_control` breakpoints

The API loop's new `cache_control` breakpoints are sent on every request, so a
`claude.api_endpoint` pointing at a gateway or proxy that rejects the field
(some OpenAI-to-Anthropic shims, some enterprise gateways, Bedrock's legacy
InvokeModel path for models without caching) would fail every run's first turn
with a 400 without a way to turn the markers off.

`hench.promptCache` (boolean, default `true`) is the escape hatch. When set
to `false`, the API loop sends the request as it looked before prompt caching
was added: `system` as a plain string, tools and messages untouched, zero
`cache_control` markers anywhere. `ndx config hench.promptCache false`
persists it to `.hench/config.json`.
