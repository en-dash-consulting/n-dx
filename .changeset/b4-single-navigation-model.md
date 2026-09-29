---
"@n-dx/web": patch
---

Dashboard: one name per view, read by every navigation surface.

View labels lived in four tables that had drifted apart — the breadcrumb, the
guide, the stage sections, and a SourceVision tab list nothing rendered. The
import map was "Map" in the breadcrumb and "Repository map" on the Analysis
page, and both the agent run list and the PRD execution log were called
"History". A new `viewer/views/view-meta.ts` gives every view one label, glyph,
product and blurb; `stages.ts` re-exports it and now records only *where* each
view sits. The top nav, stage pages, Home cards, breadcrumb, `document.title`,
guide headings and settings overlay all read it.

Labels that changed: the run list is **Runs** and the PRD log is **Execution
Log** (both were "History"); the import map is **Repository Map** everywhere;
Rex's "Analyze & Import" is **Add Items**; "Rex Dashboard" is **Up Next**; and
the Workspaces board is **Workspaces** in the breadcrumb rather than "Overview",
which previously collided with SourceVision's Overview. No route changed.

Navigation controls also keep an accessible name at narrow widths, where the
shell hides some of their text.

Fixes a crash on the Home page: `/api/status` is parsed with an unchecked cast,
so a 200 whose body was missing a section threw during render and left the
default landing page blank. A missing section now costs that card its numbers,
the way an unavailable status already did.
