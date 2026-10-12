---
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

Pair review now runs end to end. With `hench.review.mode: "pair"`, the other
vendor's CLI reviews the diff and reports; must-fix findings resume the
executor's session to fix them, up to `hench.review.rounds`, and lesser findings
are captured to the PRD. `GET /api/llm/config` reports `review.pairSupported:
true`, so Robot Wrangler enables the Pair card. The review modes are documented
in the configuration guide.
