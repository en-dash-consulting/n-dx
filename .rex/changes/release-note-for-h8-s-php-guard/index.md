---
id: "765655a7-938f-4627-a628-dbf1fc9fe6d2"
type: "change"
title: "Release note for H8's PHP guard reporting after 0.10.5 consumed its changeset"
slug: "release-note-for-h8-s-php-guard"
summary: "Release 0.10.5 shipped the PHP guards' release note before the H8 fixes were added to it, so those fixes would ship with no note. A new note describes only what H8 adds."
intent: "Release PR #1054 (main 9e75e3f03, hench 0.10.5) consumed .changeset/hench-php-guards.md; its text is in packages/hench/CHANGELOG.md without the H8 wording that #1094 had added (5716a9836, fda32d4dd). Merging main into #1094 keeps the deletion (35117b4f1), so H8's user-visible changes need a new changeset."
acceptanceCriteria:
  - "A new hench patch changeset describes only H8's additions"
  - "changeset-body-policy passes and changeset status lists @n-dx/hench"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
discoveredFrom: {"item":"94add228-871f-4544-bcb3-6c25ff72ef4d"}
---
