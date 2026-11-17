---
id: "73f9f4e8-b12d-4a80-9f0c-40da6dd26f48"
type: "change"
title: "domain-isolation's config.js import check misses multi-line imports"
slug: "domain-isolation-s-config-js-import"
intent: "tests/e2e/domain-isolation.test.js (~437) checks config.js' imports line by line, so the multi-line `import {…} from \"./file-permissions.js\"` (config.js ~25) is never seen; file-permissions.js is not in `allowedLocalHelpers` and passes only because of the miss. packages/core/AGENTS.md (seam table, config.js row) still says \"its two helpers\" while config.js imports four.\n\nReachable: the policy silently allows any multi-line import into config.js.\n\nFix options: (1, recommended) parse imports across lines (as architecture-policy does), add file-permissions.js to allowedLocalHelpers deliberately, and correct the AGENTS.md row; small.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "A multi-line import of a disallowed module into config.js fails domain-isolation"
  - "packages/core/AGENTS.md names every local helper config.js imports"
priority: "low"
source: "ndx-adversarial-review"
---
