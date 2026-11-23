---
id: "9ca83f82-ad7b-4459-8adf-258b00e4e74f"
type: "change"
title: "PR 12 stack-review fixes: URL passwords with / or # redacted, minified rule narrowed"
slug: "pr-12-stack-review-fixes-url-passwords"
summary: "A review of the PHP work found that some database passwords can still appear in analysis output, and that ordinary hand-written script files can be mistaken for compressed bundles and left off the map. This closes the leak and makes the bundle check stricter."
intent: "Found by the stack review posted on #1083 (PR 12) on 2026-11-18, at head a114ab88d, reproduced on the stack tip b8f3537e1. Both are in code PR 12 (change 01376afa) added; PR 12's own promise is that no secret value reaches an output file.\n\n1. P2: `packages/sourcevision/src/util/redact-literals.ts` `URL_AUTHORITY` ends the authority at the first `/`, `?` or `#`, so a password holding one of them keeps the whole URL: `mysql://app:pa/ss@db/app`, `tcp://:se/cret@redis:6379` and `postgres://u:p#ss@h/db` come out unchanged (`pgsql://app:p@ss@pg/app` is already right). Generated passwords often hold `/` (base64). This is P4(c) from the #1082 review, which this layer was meant to close.\n2. P3: `packages/sourcevision/src/analyzers/minified.ts` marks any `.js`/`.mjs`/`.cjs`/`.css` file with one line over 2,000 characters in its first 64 KiB as role `generated`, in every repository. A hand-written file with an inline data URI, SVG or JSON blob then leaves `callgraph.json` and `components.json`, silently.\n\nPrivacy rule: no client name, repository name, path or finding text in this repository. Fixtures are invented.\n\nLane rules: every code change goes through `ndx work`; targeted tests only, CI (`ci:run`) runs the suites. Patch changesets with scoped names."
acceptanceCriteria:
  - "The three URLs above lose their user and password in redactLiterals output, and legitimate URLs with @ or : in the path or port are unchanged"
  - "A hand-written JS or CSS file with one long data-URI line keeps its role; a real minified bundle is still generated"
  - "Every relabelling by content is visible in the analyze log"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
discoveredFrom: {"item":"01376afa-1f03-4da1-b42e-2baef55d2c9b"}
tags:
  - "sourcevision"
  - "security"
  - "php-pr12"
  - "stack-review"
---
