---
"@n-dx/web": patch
---

Mark where the SourceVision Ask panel and its Rex/Hench siblings will land

The PRD gained a "SourceVision Ask Panel" feature — a gated text exchange over
the analysed project that can explain a finding in plain language and propose
PRD refinements. The code side of this branch is markers only, no behaviour: a
placement comment in `SOURCEVISION_TABS` for the gated `Ask` tab, plus adoption
markers in `domain-rex.ts` and `domain-hench.ts` for the two surfaces that want
the same panel afterwards.

The Rex and Hench panels are intentionally absent from the PRD. The sequence is
to build the SourceVision one, generalise it, then lift the shared piece out —
so the markers record the intent (and, for Rex, that a panel there must reuse
the existing `withTransaction` apply path rather than adding a second PRD write
surface) without implying scheduled work.
