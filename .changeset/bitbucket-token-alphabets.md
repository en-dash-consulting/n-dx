---
"@n-dx/llm-client": patch
---

Bitbucket and Atlassian credentials are redacted in full, not up to their
first `-`, `_`, `+` or `/`.

The four Atlassian patterns in `redact.ts` were written from memory with no
network access, and their body character classes were too narrow. A body
character outside the class ends the match, so the prefix was replaced and
everything after that character stayed in the run record in plain text — the
worst shape a redaction bug can take, because the output looks redacted.

Each class is now taken from a published detector ruleset, cited in the code:

- `ATBB` (Bitbucket Cloud app password) — trufflehog's
  `bitbucketapppassword` detector, whose own fixture `ATBBa9iO-tyg7u_op`
  carries both `-` and `_`. The length floor also came down: real app
  passwords are far shorter than the previous 20-character body minimum, so
  one was not matched at all.
- `ATATT` / `ATCTT` — gitleaks' `atlassian-api-token` and trufflehog's
  `atlassian/v2`. Both show `+` and `/` in the body; neither was in the class.
- `BBDC-` (Bitbucket Data Center, prefixed since Data Center 8) — the body is
  plain base64, so `+`, `/` and `=` belong in it.

The unit-test fixtures were runs of a single repeated letter built to clear
each regex's own floor, so they could only ever confirm the regex against
itself. They now carry the documented body characters, and a new test checks
the *suffix* after each one rather than the whole token — the old assertion
(`not.toContain(secret)`) passed even when half the credential survived.
