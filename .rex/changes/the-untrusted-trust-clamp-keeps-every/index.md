---
id: "5d6f42fa-0b0a-4dfd-b87e-2dbe2f068a62"
type: "change"
title: "The untrusted trust clamp keeps every dependency directory blocked"
slug: "the-untrusted-trust-clamp-keeps-every"
intent: "Follow-up to \"Repository trust can't be steered by the repository\" (346e0812) from Hal's adversarial review of #816 (diff mode, origin/main...fix/security-repo-trust), posted 2026-10-20: https://github.com/en-dash-consulting/n-dx/pull/816: findings F1 and F2. The detected language still decides which dependency directory the untrusted clamp blocks, and the assessment never checks a guard's dependency-directory blocks. Layer 1 of the security stack (#816)."
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
discoveredFrom: {"item":"346e0812-443a-4ae2-96e4-be96607b7d97"}
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
---
