---
"@n-dx/web": patch
---

Give each of the Ask panel's degraded modes a specific, actionable message

The panel has three distinct ways to be unusable and was reporting all of them under one heading. Each now names itself.

**No analysis** explains that nothing can ground an answer and offers to run the analysis — the same `sv-analyze` trigger and status polling the enrichment gate uses, extracted into `useSvAnalyzeRun` so both surfaces share one state machine rather than printing a command and stopping.

**Credentials** render llm-client's `authFailureGuidance` for the actual vendor, each remediation step as its own step including `VERIFY_CREDENTIALS_STEP`. The strings are split back apart for display, never reworded here.

**Provider failures** — timeout, rate limit, server error, network, parse — are each named, and the ones the endpoint marks retryable offer a Retry that re-sends the same question *and its seed*, so a retried Explain does not silently become an ungrounded free-form ask.

The prompt survives every failure, so a question never has to be retyped. No path renders a bare generic string: every category has a distinct heading, and an unrecognized category from a future server still degrades to a named mode rather than a blank one.
