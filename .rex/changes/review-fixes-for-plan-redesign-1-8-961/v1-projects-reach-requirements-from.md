---
id: "d16dddb6-440d-4acc-9306-d27aabde0b50"
type: "task"
title: "v1 projects reach Requirements from the Product page"
slug: "v1-projects-reach-requirements-from"
description: "Stack review finding on #961 at packages/web/src/viewer/views/product-pages.ts:134 (review comment 4488636468).\n\n**Should fix: a v1 project has no way to reach Requirements any more**\n\nPlan dropped its Requirements section and now only lists `requirements` in `alsoOwns`, so the only way in is the Product page's Requirements tab. On v1, `ProductPage` returns `h(NoProductLayer, { title: \"Product\" })` when `tab` is \"map\" and never renders the tablist, and nothing in the viewer calls `navigateTo(\"requirements\")`. A v1 user can only reach the coverage and traceability view by typing `/requirements`, though it reads v1 data fine. The comment above `ProductPage` says \"the Map tab still says to migrate\", but v1 shows no tabs at all. The stack tip doesn't change this: S2 gives v1 only `v1Tiles: [{ view: \"prd\" }]`, and Product is `v2Only`.\n\nFix: on v1, render the tablist around `NoProductLayer`, with Map showing the migrate notice and Requirements showing `RequirementsView`. Then flip the v1 test that asserts `querySelector('[role=\"tablist\"]')).toBeNull()`."
acceptanceCriteria:
  - "On a v1 project the Product page renders its Map/Requirements tablist around NoProductLayer: Map shows the migrate notice and Requirements shows RequirementsView"
  - "The v1 test that asserted no tablist now asserts the tablist and that Requirements renders"
---
