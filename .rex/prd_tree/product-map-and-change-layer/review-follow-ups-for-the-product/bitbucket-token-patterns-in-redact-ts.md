---
id: "990a5987-b799-470f-98d1-87762a32683c"
level: "task"
title: "Bitbucket token patterns in redact.ts are tested only against samples built from the patterns themselves"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "llm-client"
  - "pr-04"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Each Atlassian/Bitbucket pattern in redact.ts cites the vendor or ruleset source its prefix, alphabet and length were checked against"
  - "redact.test.ts fixtures for ATBB, ATCTT, ATATT and BBDC- follow the documented format (alphabet, length, checksum suffix), not filler built to fit the regex"
  - "A test fails if any documented character of a real token's body is left unredacted"
description: "Verdict: should-fix (adversarial review of the Bitbucket redaction task, 1e1c6313).\n\nThe four Atlassian patterns in packages/llm-client/src/redact.ts (token rule: `ATBB[A-Za-z0-9]{20,}`, `AT(?:CT|AT)T[A-Za-z0-9_=-]{20,}`, `BBDC-[A-Za-z0-9]{20,}`) were written from model knowledge with no network access. Their unit tests (tests/unit/redact.test.ts, BB_APP_PASSWORD etc.) use samples constructed to fit those same patterns, so the tests are circular: they cannot show that a real credential matches.\n\nFailure scenario: if a real Bitbucket credential's body contains a character outside its pattern's class (for example `_` or `-` in an ATBB app password), the match stops early. The part after that character is left in the run record and log in plain text. If a prefix is simply wrong, the rule never fires for that credential kind.\n\nReachability: any hench run whose tool output prints a Bitbucket token on its own (a `cat` of a credentials file without a key name, an API error echoing the token). The key, URL-userinfo, `-u` and `Basic` rules still catch the common forms, so exposure is limited to credentials printed bare.\n\nOptions:\n(a) Recommended. Check each prefix, body alphabet and length against Atlassian's token-format documentation and an established ruleset (gitleaks or GitHub secret-scanning partner patterns). Correct the classes and floors, and replace the synthetic fixtures with format-faithful samples, citing the source in a comment. Cost: one research pass and small regex edits. Risk: low.\n(b) Widen every body class to `[A-Za-z0-9_=+/-]`. Cheaper, but it can swallow trailing context and breaks the convention that each vendor pattern is precise."
lastModified: "2026-10-06T08:36:33.216Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
