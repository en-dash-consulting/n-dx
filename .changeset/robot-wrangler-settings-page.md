---
"@n-dx/web": patch
---

Dashboard: replace the LLM Provider view with the Robot Wrangler settings page.

The page (`/robot-wrangler`, first in the settings list) renders on the shared
settings frame, so Save, the unsaved-changes indicator and the leave prompt
replace the old save bar and toast. It shows what `ndx work` will run with —
vendor, provider, model and which setting supplied it — and, when the run would
be refused, says why. Claude model fields still read from the legacy
`claude.*` keys are marked as such; saving writes `llm.claude.*`.

`GET /api/llm/config` gains `effectiveProblems`, the reasons the resolved
`effective` block would be refused (provider unsupported for the vendor, model
not belonging to it). `/llm-provider` redirects to `/robot-wrangler`.
