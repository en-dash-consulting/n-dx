---
id: "9e87cb29-be37-4d69-b4b5-5f771e520424"
type: "change"
title: "Review fixes: the run queue keeps what can still run, saves safely, and Prepare stays on Tune"
slug: "review-fixes-the-run-queue-keeps-what"
summary: "Fixes from the adversarial review of the run queue and How work moves: the queue no longer loses tasks that are only temporarily unable to run, two windows can no longer overwrite each other's queue, Prepare opens over the Tune page, and How work moves says when it cannot load."
intent: "Adversarial review of 86c16eb90..9e5d17073 (run queue e13cabca0/d5734277d, How work moves 910e17bda/9e5d17073). Four findings, all reachable from the dashboard or ndx work."
acceptanceCriteria:
  - "Every finding below is fixed with a test that fails without the fix"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "high"
discoveredFrom: {"item":"f9674fd9-5721-4da7-b9f5-891b633b352a"}
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
