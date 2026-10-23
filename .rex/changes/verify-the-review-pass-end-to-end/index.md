---
id: "0deece15-2acc-4b40-bd91-d6b6f32a1677"
type: "change"
title: "Verify the review pass end-to-end against a real ndx work run"
slug: "verify-the-review-pass-end-to-end"
intent: "Everything so far is verified by unit tests and by probing the Claude CLI directly (session_id is on every stream-json line; resume with a different model retains context, confirmed by cache reads). The spawn path itself has not been exercised end-to-end: run ndx work with review enabled against a real task and confirm the reviewer resumes, writes a parseable report, applies a must-fix repair before the commit prompt, and charges its tokens to the run."
touches:
  - "6eb227af-ffb2-4f39-8f62-d4afbad09a57"
priority: "high"
---
