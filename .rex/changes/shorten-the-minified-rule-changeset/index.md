---
id: "d45299e0-9e49-4cb5-afc7-94f9803b2f03"
type: "change"
title: "Shorten the minified-rule changeset lead to pass the changeset body policy"
slug: "shorten-the-minified-rule-changeset"
summary: "The release note for the stricter compressed-file check opens with a sentence longer than the release-notes rule allows, which fails a repository check. This shortens it."
intent: "Found while verifying change 9ca83f82 (PR 12 stack-review fixes) on restack/pr12, 2026-11-18: `tests/e2e/changeset-body-policy.test.js` fails with `.changeset/minified-by-content-share.md: lead sentence is 34 words; keep it to 30 or fewer and move mechanism to a later paragraph`. The changeset came from task 2fc61616 (commit ae1c925c4). The test passed at a114ab88d, before that task."
acceptanceCriteria:
  - "tests/e2e/changeset-body-policy.test.js passes without changing the test or the grandfather list"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
discoveredFrom: {"item":"9ca83f82-ad7b-4459-8adf-258b00e4e74f"}
tags:
  - "sourcevision"
  - "changeset"
  - "php-pr12"
---
