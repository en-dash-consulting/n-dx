---
id: "f7a55c42-ca3b-41c2-b04c-d62a80bf826d"
type: "change"
title: "Add --review flag and move the diff-approval gate to --approve-diff"
slug: "add-review-flag-and-move-the-diff"
intent: "Reassign --review from the interactive diff gate to the adversarial review pass, and rename the existing gate to --approve-diff. The two are independent and compose: the review pass runs first so a human answering the diff prompt sees the repaired tree. Runs passing --review print a line saying where the old behavior went. Touches hench run.ts flag parsing, SharedLoopOptions (review -> approveDiff), the API loop, and both help surfaces."
amends: [{"target":"6eb227af-ffb2-4f39-8f62-d4afbad09a57","delta":"modified","summary":"Add --review flag and move the diff-approval gate to --approve-diff","base":"19a7255e7fea73685a43674ec0fb0de69a48cfd1b43ee6cde6d95994702e87f3"}]
priority: "high"
---
