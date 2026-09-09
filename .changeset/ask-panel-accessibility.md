---
"@n-dx/web": patch
---

Bring the SourceVision Ask panel to the dashboard's accessibility bar.

An answer arrives after an indeterminate delay, so it has to be announced
without the user losing their place. Neither half worked.

The state cards each carried their own `aria-live`, but a live region that
mounts at the same moment as its text is not reliably announced — the region
has to already exist when the text changes. Announcements now come from a
persistent `sr-only` polite/assertive pair at the top of the panel, the idiom
`hench-runs.ts` and `prd-tree.ts` already use, and the cards are visual only so
nothing is read twice.

Submitting disabled both the textarea and the submit button. Ctrl+Enter is the
documented submit path, so that destroyed the focused element and dropped the
user at `<body>` exactly when the answer they were waiting for appeared —
reaching Copy then meant tabbing from the top of the document. The button
reports itself with `aria-disabled` (the click was already a no-op while
in flight) and the textarea stays live, since the question is snapshotted at
submit and a later edit cannot change what was asked.

Copy and capture feedback carries ✓ / ⚠ so success and failure differ by more
than green and red; the announcements omit the glyphs.

Coverage: an accessibility block in `ask-view.test.ts` (live regions, focus
retention across both submit paths, announced action feedback, non-colour
markers) and an `[a11y] AskView` axe-core audit over all four display states in
both themes plus the deployed export, which fails rather than passing vacuously
if the panel does not reach the state under audit.
