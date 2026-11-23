---
"@n-dx/sourcevision": patch
"@n-dx/core": patch
---

`ndx analyze` now detects a folder that is a near-copy of another, such as a legacy `edit/` beside `app/`, and counts its identical files once.

Each identical file of the copy is marked `mirrorOf` in `inventory.json` with its counterpart's path, `summary.mirrored` counts them, and analyze prints one `[mirror]` line per pair. Those files are left out of zones, classification, the call graph and migration totals; files where the copy diverged stay first-party. `sourcevision.mirrors` in the project config sets a pair (`{ "edit/": "app/" }`) or denies one (`{ "edit/": false }`).
