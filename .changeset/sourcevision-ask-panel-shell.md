---
"@n-dx/web": patch
---

Add the gated SourceVision "Ask" tab and its prompt/response panel

The client half of the Ask panel: a tab in `SOURCEVISION_TABS` behind the
default-off `sourcevision.ask` feature flag, and a view registered in
`view-id.ts`, `view-routing.ts`, and `view-registry.ts` so `/ask` deep-links and
survives a reload like every sibling tab. The panel owns the labelled prompt
textarea and the submit control, and consumes `POST /api/sourcevision/ask` — it
assembles no context and calls no model itself.

**One state value, not three booleans.** `idle | submitting | answered | error`
is a discriminated union. The `loading`/`error`/`data` triple the older views
use admits eight combinations for four legal states, and the illegal ones
("submitting and answered") are exactly the renders that read as a bug to
someone waiting on an answer.

**An empty prompt is not a request.** A whitespace-only prompt disables the
submit control *and* returns early from the handler an Enter keypress reaches,
so it never costs a round trip to be told you typed nothing. A concurrent
submit is refused through a ref rather than through `state.status`, which has
not been applied yet when a double click's second handler runs. A 200 carrying
an empty answer is reported as an error rather than rendered as a blank card.

**`requiresServer`, so a static export hides it.** The answer is an on-demand
LLM call and `ndx export` has no such route — deployed mode's fetch adapter
answers every non-GET with a 405 — so the tab is hidden there and the view
renders the explanatory card instead, matching the isometric map's contract.

Copy/Capture actions on the answer, per-failure-mode wording beyond what the
endpoint supplies, and seeding the prompt from a finding are separate tasks
under the same feature; the shell is shaped so each lands in one place.
