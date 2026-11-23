---
id: "aa01d3bd-60e5-44ba-b955-7e498bb8e540"
type: "change"
title: "PR 6 passes CodeQL on its own: linear connection-string scans"
slug: "pr-6-passes-codeql-on-its-own-linear"
summary: "A text pattern in the reading of database connection strings can slow down sharply on long lines, and the code scanner flags it. This brings the already-reviewed fix down into this part so it passes the scanner by itself."
intent: "CodeQL js/polynomial-redos alert #134 (packages/lang-php/src/php-outbound.ts:228) is open on #1060's merge ref; PR 11 (#1082) fixes it in 87292366a with review repair 58add3923.\n\nEvery PR in the PHP stack must pass main's required checks and CodeQL at its own head, so it can merge to main on its own. Today this PR fails at its own head because the fix only lands in a later PR of the stack. This change ports that fix down, verbatim: the ported lines must end up identical to the later PR's, so the later commit becomes a no-op for them when the stack is restacked, and the stack's top tree does not change.\n\nHow to port: `git show <sha> -- <paths>` shows the later commit's hunks; apply only the hunks for code this PR already has (`git show <sha> -- <paths> | git apply --3way`, then remove what does not belong yet), and adjust only where this PR's context differs. Do not invent new behaviour, rename things or reformat. Run only the tests named in the task.\n\nPrivacy rule: no client name, repository name, path or finding text in this repository. Lane rules: every code change goes through `ndx work`; CI (`ci:run`) runs the suites."
acceptanceCriteria:
  - "This PR (#1060) passes main's required checks and CodeQL at its own head"
  - "The stack's top tree is unchanged by the restack apart from PRD files"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
discoveredFrom: {"item":"38abed61-45be-4181-a45c-5652878ad43c"}
tags:
  - "php-stack-green"
  - "php-pr06"
---
