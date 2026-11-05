---
id: "5e9d55ad-c415-4d6d-b126-8cb65dc4f2c7"
type: "change"
title: "Keep a sidecar stopped when it is stopped after crashing during revalidation"
slug: "keep-a-sidecar-stopped-when-it-is"
intent: "PR #929 review finding F1 (endash-shal, adversarial review 2026-11-04). #929 makes SidecarManager.revalidate() restart a sidecar that exited on its own while the launch plan was awaited (s.crashed === handle). But a sidecar that crashes and is then stopped on purpose during the same revalidation is started again, breaking the PR's contract that a sidecar stopped during the check stays stopped."
acceptanceCriteria:
  - "A sidecar that crashes and is then stopped on purpose during revalidation stays stopped and the revalidating request answers 404 refused"
  - "A sidecar that crashes during revalidation and is not stopped is still restarted"
touches:
  - "3a95f9ce-cc60-4ca1-a2f9-89cdbfc7f14d"
priority: "medium"
source: "ndx-capture"
---
