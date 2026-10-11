# Upstream

Framework behaviour this product works around, each with the item it was
captured as in graview's PRD (`../../../graview/.ndx/rex/prd_tree` from this
package, under the
"Graview — spatial context-graph framework" epic). Remove the workaround
when the item closes.

Graview 0.1.22 closed the rows that stood here for the preview (`graview
preview` and `graview shots` draw a document with no product), per-kind
wording on a shared relation (`under` now reads in each kind's words), a
list's sort by a choice field over a shared relation (the change page's tasks
sort by `choices`), and a record page's budget (`resolveFor` reads a page
under a page's budget). What remains:

| # | What | Workaround here | Item |
|---|------|-----------------|------|
| 3 | A `timeline` needs lanes: `columns` or a `column` role bound to a choice field. Runs have no natural lane. | Runs are laned by outcome (`status`). | — (declaration choice, not a framework defect) |
| 4 | `brand.typography` takes a face name from a fixed list, not a CSS stack. | Manrope / Inter / JetBrains Mono, loaded in index.html. | — |
| 7 | `mcpClient` reads the last `data:` line of an event stream, not the reply matching its id. | None needed: rex's MCP server answers a `tools/call` with one event. Avoid interleaved notifications until it matches by id. | filed upstream with the 0.1.22 review |
