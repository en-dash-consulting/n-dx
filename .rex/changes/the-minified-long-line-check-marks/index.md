---
id: "945af216-4dc2-4662-9fb4-1fdddf63f92f"
type: "change"
title: "The minified long-line check marks hand-written JS with one long line as generated, counting bytes, not characters"
slug: "the-minified-long-line-check-marks"
summary: "The rule that spots minified JavaScript by a very long line can also catch ordinary hand-written files, such as translation files in Chinese or data tables kept on one line, and then drops them from several analysis outputs."
intent: "Found by the adversarial review of task 0db6172b (Treat minified bundles as generated). Verdict: should-fix.\n\n**Scenario.**\n- `src/i18n/zh.js` holds one line of about 700 Chinese characters. In UTF-8 that is over 2,000 bytes.\n- Or `src/data/countries.js` keeps a 3,000-character array literal on one line.\n\n`hasMinifiedLine` (`packages/sourcevision/src/analyzers/minified.ts`) is passed the raw buffer from `analyzers/inventory.ts` and decodes it as latin1. So it measures bytes, while the docs and the constant name promise characters. Either file gets inventory role `generated`.\n\nRole `generated` does more than leave the call graph:\n- `classifications.json` reads `source` only.\n- Outbound and route detection skip it through their role sets.\n- `components.json` skips it.\n\nSo the file silently disappears from every one of these outputs.\n\n**Reachable:** yes. Any JS, CSS, MJS or CJS file in the inventory, on every `sv analyze` and `ndx analyze` run.\n\n**Options:**\n1. Decode the head as UTF-8, so the limit counts characters. Cost: one line. Risk: a 64 KiB cut can split a multibyte character; that is harmless.\n2. Require minified shape as well as length: no indentation in the first lines, or a low ratio of newlines to bytes across the head. This cuts false positives on long data lines. Cost: small. Risk: the heuristic needs tuning.\n3. Recommended: both. Report reclassified files in the analyze log, so a false positive is visible."
acceptanceCriteria:
  - "A JS file with one line of 700 CJK characters (over 2,000 UTF-8 bytes) keeps role source"
  - "A hand-written JS data file with one long array-literal line among normally indented code keeps role source, while a one-line minified bundle is still generated"
  - "A unit test in tests/unit/analyzers/minified.test.ts covers both cases"
touches:
  - "956b7119-989e-41f1-ba0e-3e8d26494fee"
priority: "medium"
discoveredFrom: {"item":"0db6172b-4827-4226-98b5-60ca5841656c"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "sourcevision"
  - "estate-readiness"
source: "ndx-adversarial-review"
---
