---
id: "c68b966b-0160-440f-a9db-194ee6281775"
type: "change"
title: "PHP readiness omits the version-floor histogram when every file predates the oldest rule"
slug: "php-readiness-omits-the-version-floor"
summary: "A repository written entirely in old PHP gets no version histogram in its readiness report, so it looks the same as one that was never checked. Those old repositories are the ones a PHP 5 migration most needs it for."
intent: "Found by the operator's corpus check of PR 8 of the PHP stack (change a6e82740, task 4d498f89), 2026-11-16: oscommerce2 and wordpress have no versionFloors section after the error-recovery fix. Ships in PR 8."
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "medium"
discoveredFrom: {"item":"4d498f89-3213-4ad4-a8ff-ca343af7a626","run":"825f00a9-8622-4b4e-806d-2214d5166915"}
tags:
  - "php"
  - "lang-php"
  - "compatibility"
---
