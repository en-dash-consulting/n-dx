---
"@n-dx/rex": patch
---

`rex init` (and so `ndx init`) gives a project with no PRD an empty v2 tree, `product/index.md` stamped `rex/v2`, and no `prd_tree/`, so a new project no longer prints the v1 deprecation notice. A project that already has a PRD keeps its layout; moving a v1 PRD stays `ndx migrate`'s job. The next steps init prints use the v2 verb (`rex add --title=…`) whenever the tree is v2, fresh or migrated.

Changes what a CLI command creates under the soft freeze: `rex init` / `ndx init` on a project with no PRD now writes the v2 layout instead of v1. No flag or MCP tool changes shape.
