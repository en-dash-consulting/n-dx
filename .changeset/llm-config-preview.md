---
"@n-dx/web": patch
"@n-dx/llm-client": patch
---

`POST /api/llm/config/preview` resolves unsaved edits without writing them. It
takes `PUT /api/llm/config`'s body, plus an optional `provider` (the field the
page saves through `/api/hench/config`), and returns `effective`,
`effectiveProblems`, `tiers`, `failover` and `review` for the saved config with
those edits applied in memory. Refused edits come back in `editProblems`
instead of failing the request. `GET` and the preview now share one resolver;
`@n-dx/llm-client` exports `parseLLMConfig`, the in-memory half of
`loadLLMConfig`.
