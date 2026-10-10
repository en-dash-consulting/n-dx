# Upstream

Framework behaviour this product works around, each with the item it was
captured as in graview's PRD (`../../../graview/.ndx/rex/prd_tree` from this
package, under the
"Graview — spatial context-graph framework" epic). Remove the workaround
when the item closes.

| # | What | Workaround here | Item |
|---|------|-----------------|------|
| 1 | `graview serve` serves the store (HTTP + WebSocket) and draws nothing: a document with no product has no face. | This package is the face; `ndx graview serve .` finds and runs it. | graview `ead25e4a` — graview preview: mount the default faces on a document with no product |
| 2 | An edge name is one relation across kinds: `under` on six kinds must share one description and inverse, so the far end cannot say "the tasks inside it" for a change and "the zones inside it" for a zone. | One neutral sentence per shared edge name in `n-dx.graview.json`. | graview `3cc778b7` — Per-kind wording on a shared relation name |
| 3 | A `timeline` needs lanes: `columns` or a `column` role bound to a choice field. Runs have no natural lane. | Runs are laned by outcome (`status`). | — (declaration choice, not a framework defect) |
| 4 | `brand.typography` takes a face name from a fixed list, not a CSS stack. | Manrope / Inter / JetBrains Mono, loaded in index.html. | — |
| 5 | A sorted `list` over a relation several kinds declare (`in('under')`) cannot sort by a choice field unless every declaring kind has it. | `asc` on `status` instead of `choices`. | graview `0fe6fd75` — A list over a relation several kinds declare sorts by a choice field of the kinds it reaches |
| 6 | `resolveBlocks` judges a record page's blocks under a card's allowance (500 steps) unless the caller raises `budget`; a change with 98 tasks resolved every list to "—". | `src/ui/declared.tsx` passes the sweep budget for record pages too. | graview `da9b5d63` — A record page's blocks get a page's budget by default |
