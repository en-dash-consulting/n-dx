---
id: "0de764a3-70c9-48dc-9792-f625e8f72fd8"
type: "change"
title: "PHP dynamic include anchored at the repository root gets no candidates when its suffix is only an extension"
slug: "php-dynamic-include-anchored-at-the"
summary: "An include such as `__DIR__ . '/' . $page . '.php'` in a top-level file should list the root PHP files it could load, but the pack treats the root folder as \"no prefix\" and lists nothing. The include report therefore undercounts includes that have candidate files."
intent: "Found by the adversarial review of task 3679880e (run e7e2370f). Pre-existing since task fd220c20. Verdict: out-of-scope, medium.\n\nScenario: root `index.php` with `include __DIR__ . '/' . $page . '.php';` (or `'./' . $page . '.php'`), repository files `home.php`, `about.php`. `PhpIncludes.candidates` returns undefined (checked against dist: `new PhpIncludes([], new Set(['home.php','about.php','pages/x.php']), []).candidates('index.php', \"__DIR__ . '/' . $page . '.php'\")` → undefined; the same with `'/pages/'` gives `pages/x.php`).\n\nCause: packages/lang-php/src/php-includes.ts `candidates()` skips a `start === \"\"` whose suffix has no `/`. `candidateStarts` returns `\"\"` both for no prefix and for a prefix that locates to the repository root directory, so a real root-directory prefix gets the \"a bare extension constrains nothing\" rule meant only for the no-prefix case.\n\nReachable: `ndx analyze` with the PHP pack, any root-level front controller (`index.php?page=…` routing), and php-resolve-report.mjs's \"with candidate files\" count.\n\nFix options: (A, recommended) key the no-prefix rules on `ends.prefix === \"\"` rather than `start === \"\"`; a root-located prefix then matches files directly in the root directory that end with the suffix (a candidate must not contain `/` past the start when the prefix ends in `/`? no: PHP allows `$page = 'sub/x'`, so match any file ending with the suffix, as non-root starts do). Cheap, one branch plus a test. Risk: the candidate list for root includes grows toward the 50 cap on large repos; MAX_INCLUDE_CANDIDATES already bounds it. (B) Return a sentinel from candidateStarts for the root. More code, same result."
acceptanceCriteria:
  - "`__DIR__ . '/' . $page . '.php'` and `'./' . $page . '.php'` written in a root-level file list the repository's `.php` files as candidates, proven by a lang-php test"
  - "An include with no computable prefix and a suffix without `/` (`$name . '.php'`) still gets no candidates"
  - "Candidates still never become import edges"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "medium"
discoveredFrom: {"item":"3679880e-8370-4938-9834-2fe6c87b8265","run":"e7e2370f-481c-489f-80b8-b32942dde144"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "php"
  - "lang-php"
source: "ndx-adversarial-review"
---
