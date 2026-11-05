---
id: "825ee61b-61ee-4914-966b-6faa332d961c"
type: "task"
title: "Tracker sync sends a CODEOWNERS GitHub handle as the CAOS reviewerNotionUserId"
slug: "tracker-sync-sends-a-codeowners-github"
description: "Verdict: should-fix (found by the adversarial review of 3b86452e).\n\nScenario: if a profile has no defaults.reviewer and CODEOWNERS has `/packages/web/ @hal`, the PR-opened move goes out with review.reviewerNotionUserId = \"@hal\". That is a GitHub handle, and the property needs a Notion user id. CAOS refuses the call, or assigns the wrong person. A refusal settles the event, so the move is never retried.\n\nEvidence: packages/web/src/server/tracker/rules.ts, resolveFact, case \"codeowners\", which passes record.sources.codeowners through as is. That value is set from tracker/codeowners.ts ownerOfFiles in event-sources.ts prOwner.\n\nReachable: yes, through POST /api/tracker/sync/tick, when the pr-opened rule is on, GitHub reads are on, the project has a CODEOWNERS file and the profile has no default reviewer.\n\nOptions:\n(a) Add a profile- or user-level map from a CODEOWNERS handle to a tracker user id, for example trackerSync.reviewers in .n-dx.local.json. An unmapped handle becomes a card (\"map @hal to a CAOS user\"). Low cost; this is the recommended option.\n(b) Drop codeowners from the CAOS reviewer sources, so only the profile default supplies it. Cheapest, but it loses the story's CODEOWNERS fallback."
acceptanceCriteria:
  - "A PR-opened move whose reviewer comes only from CODEOWNERS sends the mapped tracker user id, never the raw @handle (test)"
  - "A CODEOWNERS handle with no mapping becomes a card naming the handle to map, and no call is made (test)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
