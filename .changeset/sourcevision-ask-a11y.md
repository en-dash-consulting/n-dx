---
"@n-dx/web": patch
---

Make the SourceVision Ask panel usable without sight or a mouse.

An async text exchange has one accessibility requirement the other
SourceVision subviews do not: the answer arrives after an indeterminate delay,
so it has to be announced rather than merely rendered. Four defects followed
from that, and each is now fixed and pinned by a test in
`tests/unit/viewer/ask-view-a11y.test.ts`.

- **Arrival was not reliably announced.** The answer card was itself the live
  region, so the region came into existence in the same render as its content —
  which screen readers do not reliably announce. There is now one persistent
  polite region, mounted with empty text while idle, and the answer card is a
  `role="region"` labelled by its heading. The test asserts *node identity*
  across the transition, because an equal-looking replacement would satisfy a
  presence check and still fail a reader.
- **Arrival announced the whole answer.** A live region reads its entire text,
  so a 400-word answer buried the one fact the waiting user needed and talked
  over whatever they were reading. The region now reports that the answer is
  ready, how long it is, and where to find it; the answer is read on demand.
  Making the card live also meant a live *ancestor* claimed every descendant
  update, so each later "Copied" line re-read the answer with it.
- **Submitting stole focus.** The textarea and the submit button were both
  `disabled` while the request was in flight, and the browser blurs a disabled
  element — so pressing Enter in the prompt, or Enter on the button, dropped
  focus to `<body>` and left a keyboard user at the top of the document for the
  length of an LLM call. The textarea is now `readOnly` and the button carries
  `aria-disabled`; `submit()` already refused the second request, so nothing
  needed to be disabled to prevent one.
- **Success and failure differed only in hue.** Both feedback lines now carry a
  shape marker as well as a colour, and a capture failure adds a
  screen-reader-only "Capture failed:" prefix — its message comes from the
  server and may state a fact ("PRD is locked by pid 4212") that does not read
  as a failure on its own.

The panel also joins the axe-core audit (idle and deployed-mode states, light
and dark), and `docs/accessibility.md` gains the behavioural-suite table that
records what axe cannot check.
