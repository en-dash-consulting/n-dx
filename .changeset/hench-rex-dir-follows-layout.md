---
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

hench finds the PRD on a project moved to the `.ndx/` layout when its config still holds the legacy default `rexDir: ".rex"`: `ndx work --task`, `--resolve` and `--plan-queue` follow the layout's rex dir, while a deliberate value still wins. `ndx migrate-layout` rewrites a legacy-default `rexDir` and verifies it; the dashboard shows the layout's rex dir as the field's default.
