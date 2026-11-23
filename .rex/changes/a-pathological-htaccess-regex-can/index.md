---
id: "e4b04fb7-018c-4b03-8e6f-aab2f46bd801"
type: "change"
title: "A pathological .htaccess regex can stall PHP route analysis"
slug: "a-pathological-htaccess-regex-can"
summary: "The PHP pack runs the patterns written in a site's .htaccess files against its page names. A badly written pattern can make that step take a very long time, so analysis of that repository appears to hang."
intent: "Found by the adversarial review of task 3a05f5ae (PHP docroot routes). Verdict: should-fix, low.\n\nScenario: a repository's `.htaccess` holds `RedirectMatch 403 ^(a+)+$` (or a `<FilesMatch>` with nested quantifiers), and a page under the docroot is named `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!.php`. `parseHtaccess` compiles the pattern with `new RegExp` (packages/lang-php/src/php-htaccess.ts, RedirectMatch case and `filesMatcher`), and `DocrootAccess.denied` (packages/lang-php/src/php-docroot.ts) tests it against every page URL and file name. V8's backtracking engine takes exponential time, so `analyzeProject` with routes wanted stalls. lang-kit's AGENTS.md requires scans of repository content to stay linear.\n\nReachable: `ndx analyze` / `sv analyze` on any PHP repository with the PHP pack installed (routes are requested in the imports phase). Legacy client repositories rarely carry such patterns, hence low.\n\nOptions:\n1. Bound the input: skip a pattern whose source has nested quantifiers (a cheap static check), with a notice. Cheap; misses some shapes.\n2. Run the matching in a worker with a time budget (tests/helpers/call-within-budget.ts shows the pattern) and drop the pattern on timeout with a notice. Robust; adds a worker per analysis.\n3. Use a linear-time engine (RE2 via WASM). Most robust; adds a dependency, which the pack rules discourage.\nRecommendation: option 1 plus a cap on the number of patterns tested, unless a corpus run shows real .htaccess patterns that option 1 rejects."
acceptanceCriteria:
  - "A RedirectMatch 403 or FilesMatch pattern with nested quantifiers, tested against a 40-character adversarial page name, does not stall docroot route reading (a test run through tests/helpers/call-within-budget.ts finishes within its budget)"
  - "A pattern that is skipped or abandoned is named in a PHP notice with its .htaccess file and line"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "low"
discoveredFrom: {"item":"3a05f5ae-c70a-4380-af5d-2f0ff142d000","run":"7feab726-1d6f-4c84-9668-06a01bafec7e"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "lang-php"
source: "ndx-adversarial-review"
---
