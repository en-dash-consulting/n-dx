---
id: "cc178a68-d106-4fd9-bd9f-c9a0ba69ac49"
type: "change"
title: "PR 10 passes on its own: changeset lead and call-form dynamic-code docs"
slug: "pr-10-passes-on-its-own-changeset-lead"
summary: "This part of the PHP work fails two repository checks by itself: a release note opens with a sentence longer than the rule allows, and the docs write PHP functions in a way the docs check mistakes for tool names. This brings down the already-reviewed fixes."
intent: "Required test tests/e2e/changeset-body-policy.test.js fails at #1081's head: `.changeset/php-dynamic-code.md` lead sentence is 49 words (limit 30); PR 12's 612011bd3 shortens it. tests/e2e/docs-command-refs.test.js also fails there on the **Dynamic code** and **Database-driven dynamic code** bullets of docs/packages/sourcevision.md, which PR 11's c9ad315f1 writes as calls.\n\nEvery PR in the PHP stack must pass main's required checks and CodeQL at its own head, so it can merge to main on its own. Today this PR fails at its own head because the fix only lands in a later PR of the stack. This change ports that fix down, verbatim: the ported lines must end up identical to the later PR's, so the later commit becomes a no-op for them when the stack is restacked, and the stack's top tree does not change.\n\nHow to port: `git show <sha> -- <paths>` shows the later commit's hunks; apply only the hunks for code this PR already has (`git show <sha> -- <paths> | git apply --3way`, then remove what does not belong yet), and adjust only where this PR's context differs. Do not invent new behaviour, rename things or reformat. Run only the tests named in the task.\n\nPrivacy rule: no client name, repository name, path or finding text in this repository. Lane rules: every code change goes through `ndx work`; CI (`ci:run`) runs the suites."
acceptanceCriteria:
  - "This PR (#1081) passes main's required checks and CodeQL at its own head"
  - "The stack's top tree is unchanged by the restack apart from PRD files"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
discoveredFrom: {"item":"ec248078-5c99-4dd6-b4a8-b7d4311313f6"}
tags:
  - "php-stack-green"
  - "php-pr10"
---
