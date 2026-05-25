---
"@n-dx/web": patch
---

When a zone is active in the Graph view, the masthead metric tiles now show
*zone-scoped* numbers (zone files / project files, internal imports, external
packages used, neighbor zones) instead of repeating the project totals. The
previous behavior was misleading — "102 files / 115 imports" stayed in the
hero even when you'd zoomed into a 5-file zone.

Side-by-side breakpoint lowered to 1100px and reinforced with `!important`
so the Current Selection panel actually docks to the right on wide screens
rather than getting silently overridden by the base column layout.
