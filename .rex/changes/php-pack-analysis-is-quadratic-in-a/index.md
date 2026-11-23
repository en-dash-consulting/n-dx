---
id: "e3ca4d68-f21f-413c-96cc-65e856228ab2"
type: "change"
title: "PHP pack analysis is quadratic in a long `.` concatenation chain"
slug: "php-pack-analysis-is-quadratic-in-a"
summary: "Analyzing a PHP file that joins thousands of values with `.` in one expression takes seconds and grows with the square of its length, so a repository with generated string-building code slows the whole run."
intent: "Verdict: out-of-scope (pre-existing; severity low). Found by the adversarial review of task a5be0950 (run 93141335).\n\nMeasured with the built @n-dx/lang-php over one file `<?php $x = $v0 . $v1 . … ;` (operands `$v0`–`$v49` repeated): pack.analyzeProject with kinds [\"imports\"] alone takes ~11.8 s at 5000 operands; 1000 operands ~2 s, 2000 ~5 s. legacyConstructs and dynamicCode add little on top, so the cost is in the parse/capture path or the imports rules, not the dynamic-code framework. Likely cause (unconfirmed): a query capturing each nested binary_expression with its full text (left-nested chain → O(n²) text), or a per-capture scan over the file. lang-kit AGENTS.md requires scans of repository content to stay linear.\n\nReachability: any analyze of a PHP repository with the pack installed, on a file with a very long single concatenation expression (generated templates or SQL builders). Rare in hand-written code.\n\nOptions: (a) recommended: profile the 5000-operand file to find the capture or rule that is quadratic, then make it linear (e.g. capture only what a rule reads, or read text lazily from spans); (b) cap the analysed expression size per file with a notice (loses facts in that file)."
acceptanceCriteria:
  - "Analyzing a PHP file holding one 5000-operand `.` concatenation with kinds [\"imports\"] completes in under 2 s, checked by a test or a corpus-script measurement recorded on the change"
  - "Time to analyze the file grows linearly with operand count: doubling from 2500 to 5000 operands at most roughly doubles the time"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "low"
discoveredFrom: {"item":"a5be0950-1068-442a-b018-ec76d52b5348","run":"93141335-d9ad-43bc-a586-974a027c4573"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "lang-php"
  - "performance"
source: "ndx-adversarial-review"
---
