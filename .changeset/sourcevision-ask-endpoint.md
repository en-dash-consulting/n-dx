---
"@n-dx/web": minor
---

Add `POST /api/sourcevision/ask` — answer a question about the analyzed project,
grounded in the `.sourcevision/` analysis.

Request `{ prompt, seed? }`, response `{ answer, vendor, model, tokens, sources }`.
Vendor and model come from the project's own LLM config and are reported back,
because an answer cannot be judged without knowing what produced it.

**Context is the `CONTEXT.md` digest, behind a seam.** The task left the
bundle-vs-tool-use decision open. The analysis artifacts settle most of it:
`CONTEXT.md` is ~5.9k tokens and written to be read by a model, while
`zones.json` is ~150k and `imports.json` ~351k. Only the digest fits alongside a
question and an answer, so the endpoint sends it — one call, predictable cost.

That has a real ceiling: the digest supports "what does the billing zone do" and
cannot support "who imports `parse.ts`", because the artifact holding import
edges is fifty times too large to attach. `AskContextSource` is the seam that
keeps the door open — the route depends on the interface, not the digest, so a
lookup-driven source is a new implementation rather than a rewrite of the route
and its tests.

**This is the web server's first in-process model call.** Every other heavy
operation it exposes spawns a CLI. A spawned child that dies leaves an exit code
to report; an in-process call that stalls leaves the request hanging. So every
failure `@n-dx/llm-client` classifies gets its own status and is named in the
body — 401 auth, 429 rate-limit, 504 timeout, 503 CLI-not-found, 502 otherwise —
rather than collapsing into a 500 that tells the caller none of it. A project
with no analysis returns 409 instead of letting the model answer from
imagination.

No direct `@n-dx/sourcevision` import: the analysis is already-written output
read from disk, and anything needing the sourcevision API would go through
`domain-gateway.ts`.
