---
"@n-dx/hench": patch
---

Stop reporting a failed must-fix repair as a finding that could not be captured to the PRD. `action: "failed"` has two producers — a denied capture, and a must-fix whose repair the reviewer tried and could not make work (the brief asks for exactly that record) — and `captureFailedFindings` filtered on the action alone. One failed repair therefore fired two warnings at once: the correct "must-fix findings were not repaired" and a spurious "could not be captured to the PRD — file them", which points at the wrong remedy for something that was never meant to be filed. It also overcounted `run.review.captureFailedCount`. Must-fix findings are now excluded from the capture-failure list, where they were already covered by the unrepaired-must-fix warning.
