---
"@n-dx/web": patch
---

The isometric map is now a dashboard view instead of a link out to a raw page.

**SourceVision → Isometric Map** renders the map inline and puts its generation options in the UI: Source (auto / SourceVision analysis / direct scan), Max nodes (1–500) and an externals toggle, with Generate, Open in new tab and Download HTML. Each request is fetched by the view rather than handed straight to the frame, so "no analysis yet" arrives as a readable card that points at `ndx analyze` or the direct-scan option instead of a JSON error page rendered inside the map. The map document itself runs in a scripts-only sandbox — it needs scripts for pan, zoom and zone selection, and nothing else.

The view is hidden from navigation in an exported dashboard, where no server exists to build the map, and the Architecture page's old external link now points at the view.
