---
"@n-dx/web": patch
---

The Analysis page is a dashboard. The codebase map leads as a full-width hero, followed by tiles for Next steps, Problems, Suggestions, Zones, Files, Architecture (with Routes), Languages, and the gated PR markdown and Ask. Each collapsed tile shows a compact summary built from the loaded analysis — severity counts and the worst findings, the largest zones' share, file totals by role — and expands in place across the grid or opens full-screen. A full-screen tile sits beside the detail panel when an item is open, and each closes on its own. Expanded tiles are remembered. The Terrain section is gone; the flat repository map keeps its own page.

Smaller fixes: finding cards lose their stray list bullets; the floating status pills (sessions, uncommitted files, running operations, refresh queue) share one bottom-right dock and open their panels above themselves instead of overlapping; archetype cells in the Files table look like the select they become; and every select leaves room for its arrow.
