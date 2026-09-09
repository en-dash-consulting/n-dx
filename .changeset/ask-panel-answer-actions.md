---
"@n-dx/web": patch
---

Add Copy and Capture-to-PRD actions to the SourceVision Ask panel.

Copy runs a shared clipboard workflow lifted out of the PR Markdown view into
`viewer/utils/clipboard.ts` — `navigator.clipboard` with an `execCommand`
fallback, and a permission denial reported distinctly from a generic failure.
The Overview Next Steps panel now uses the same helper instead of its own
duplicate fallback.

Capture-to-PRD is confirm-guarded: the first click arms it, the second commits,
and `POST /api/rex/capture-ask` files the answer as a feature under a
find-or-create "SourceVision Ask" epic and reports both the created item and
its parent. A failed capture leaves the answer in place and still copyable.
