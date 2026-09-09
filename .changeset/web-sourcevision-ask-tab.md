---
"@n-dx/web": patch
---

Add the gated SourceVision **Ask** tab and its view shell — a prompt/response
text exchange over the analysed project, consuming `POST /api/sourcevision/ask`.

The tab sits behind the default-off `sourcevision.ask` feature toggle and is
registered the same way its siblings are (`view-id.ts`, `view-routing.ts`,
`view-registry.ts`, breadcrumb and favicon maps), so a direct URL to `/ask`
restores the view on reload rather than falling through to the 404.

**The four display states are one union, not three booleans.** `idle`,
`submitting`, `answered`, and `error` are mutually exclusive, so the shell holds
a single discriminated union and each state renders from its own branch. The
sibling views predate that choice and carry a flag per concern — `pr-markdown.ts`
holds fourteen, which is why it needs a chain of `!loading && !error && …`
guards to decide what to draw. A new panel does not have to inherit that.

**A blank prompt is a no-op, not an error.** Whitespace-only input leaves the
submit control disabled and issues no request, and the keyboard path
(Cmd/Ctrl+Enter, which bypasses the disabled attribute) is guarded separately —
the user has not asked anything yet, so there is nothing to report and nothing
to spend a model call on. An in-flight request blocks a second one.

**Marked `requiresServer`.** An answer needs a live model call, which a static
`ndx export` bundle cannot make. The tab is therefore hidden in deployed mode,
and a direct URL lands on a card saying why rather than failing on first submit.

Answers render as preserved text. Markdown rendering needs a renderer the viewer
does not yet share — `pr-markdown.ts` has one, but it is private to that module
and lifting it out is a refactor of that view, not part of this shell.
