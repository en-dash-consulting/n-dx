---
id: "94add228-871f-4544-bcb3-6c25ff72ef4d"
type: "change"
title: "PHP stack: #1082 review findings still open at the stack tip"
slug: "php-stack-1082-review-findings-still"
summary: "An earlier review of the PHP work found problems that are still not fixed: some projects are detected as the wrong language, very large legacy sites can run out of memory, some file links and routes are missed or invented, and a few settings and messages are wrong. This collects them so each can be fixed and checked."
intent: "The stack review posted on #1090 on 2026-11-18 (tip b8f3537e1) re-checked the adversarial review on #1082 (PR 11, comment 6934470011) and its inline database-flow thread (4593510905). These findings are still open: none of their files changed since PR 11, and no PRD capture was found. A2, A4, H5 and P7 are captured elsewhere; C2 is fixed; the PR 12 redaction change (9ca83f82) covers P4(c).\n\nEach task: reproduce the finding at this head first with an invented fixture. If it no longer reproduces, record why and complete the task with no code change.\n\nPrivacy rule: no client name, repository name, path or finding text in this repository. Fixtures are invented; public projects (osCommerce, CodeIgniter, Joomla, WordPress, Monolog, Guzzle) may be named as shapes.\n\nLane rules: every code change goes through `ndx work`; targeted tests only, CI (`ci:run`) runs the suites. Analyze output for non-PHP repositories stays byte-identical unless the task says otherwise. Patch changesets with scoped names. This change may ship as more than one PR: detection (A1, A6), pack cost (P1, P5, P6), pack correctness (P2, P8, P9, P10, P11, database flow) and hench (H3, H8)."
acceptanceCriteria:
  - "Every task's finding is fixed with a regression test, or recorded as no longer reproducing"
  - "Non-PHP analyze output is unchanged except where a task fixes a regression against main"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
discoveredFrom: {"item":"e2fb42b1-e547-4682-a2ef-176d0e7d7857"}
tags:
  - "lang-php"
  - "lang-kit"
  - "sourcevision"
  - "hench"
  - "php-pr15"
  - "stack-review"
---
