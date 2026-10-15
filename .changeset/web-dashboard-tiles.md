---
"@n-dx/web": patch
---

The Analysis page is a dashboard. The codebase map takes the top-left two thirds across three rows, with Codebase health and Next steps beside it; Problems, Suggestions, Zones, Architecture (with Routes), Files, Languages, and the gated PR markdown and Ask follow in aligned rows of three. Each tile shows a compact summary built from the loaded analysis — severity counts and the worst findings, the largest zones' share, file totals by role — and its header opens it full-screen, beside the detail panel when an item is open. The Terrain section is gone; the flat repository map keeps its own page.

Smaller fixes: finding cards lose their stray list bullets; the floating status pills (sessions, uncommitted files, running operations, refresh queue) share one bottom-right dock and open their panels above themselves instead of overlapping; archetype cells in the Files table look like the select they become; and every select leaves room for its arrow.

The breadcrumb row is gone. The project name — a project menu behind a hub with several projects, after a Hub link — and the worktree · branch chip sit in the top bar, with the page's guide beside search; each view's own page is titled by the shell.
