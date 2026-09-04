---
"@n-dx/web": patch
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

Add `POST /api/sourcevision/ask`, answering a question from the existing analysis

The SourceVision Ask panel's server half. The request is
`{ prompt, seed? }` validated by a zod schema; the response is
`{ answer, vendor, model, tokens, contextSources }`.

**Bundle, not a tool-use loop.** Context is pre-assembled from the
`.sourcevision/` artifacts already on disk — manifest, inventory, imports,
zones, findings, derived next steps, component count, and a `CONTEXT.md`
excerpt — and sent in a single non-agentic call. A loop that queried lookups on
demand would answer a wider range of questions, but at an unbounded number of
round trips per question and with no way to test what the model actually saw. A
unit test now asserts the assembled facts reach the completion request, which is
the property the whole endpoint rests on. Every section is capped and reports
what it cut, so the bundle does not grow with the repository until the vendor
rejects it as an opaque 400.

**Analysis is the only ground truth.** The endpoint reads no source, and refuses
with `no_analysis` rather than letting the model answer from its priors when
nothing has been analysed. All sourcevision access — including the five artifact
schema types the reads are parsed against — goes through
`server/domain-gateway.ts`; the gateway's export cap moved 15 → 16 with that
reason recorded.

**Named failures, and it cannot hang.** Vendor and model come from the project's
own config via `loadLLMConfig` + `resolveTaskModel` (new `sourcevision.ask`
class, standard tier, reroutable through `llm.routes`), and the pair that served
the call is reported back so the panel never has to guess which model produced
an answer. The call races a budget — `sourcevision.ask.timeoutMs`, default 120s,
also passed down so a CLI-mode child bounds itself — and every failure returns a
named `kind` (`timeout`, `rate_limit`, `auth`, `network`, `no_analysis`,
`invalid_request`, `llm_error`) with the vendor's retry delay when it supplied
one, instead of a generic 500. A provider that already threw a typed
`ClaudeClientError` is trusted over re-classifying its message, so a 429 the
provider knew about is never downgraded to `unknown`.

The task-class registry contract test now scans `web` as well as the three
domain packages: web declares classes now, and an unregistered one there
resolves silently to the standard tier exactly as it would anywhere else.
