---
"@n-dx/web": patch
---

Give each of the Ask panel's degraded modes a message worth reading.

The panel has three distinct ways to be unusable and they call for three
different actions — run an analysis, fix credentials, or try again — but every
one of them rendered the same shape: a heading reading "Unable to answer" and
one line of provider text.

`sourcevision-ask-diagnostics.ts` now turns each failure into a code, a summary
naming the mode, remediation the user can act on, and whether asking again
could plausibly work. The route attaches it to the 409 and to every classified
error; `error` stays a one-line string for callers that only want text. The
panel renders the summary, the remediation as steps, and only the actions that
fit: a retry for a timeout or a rate limit, never for rejected credentials or a
missing CLI, where clicking again cannot help.

Auth wording is passed through from llm-client's `authFailureGuidance` rather
than restated. It is vendor-aware — `claude logout && claude login` is wrong
advice for a Google key — and ends with the same `ndx auth` verification step
every other surface prints, so the dashboard does not develop its own dialect
of the product's one auth message. The provider's raw 401 body is deliberately
dropped from it.

For the no-analysis case the panel offers the analyze action itself, not a
printed command. The start-and-poll flow moved out of `EnrichmentGate` into a
`useSvAnalyze` hook so both surfaces run the same one, including its treatment
of a 409 as "already running" rather than an error.

A rejected fetch has no server-side diagnosis, so the panel supplies one and
still offers a retry — otherwise the transport path would have been the last
mode rendering a bare string. The prompt survives every failure.
