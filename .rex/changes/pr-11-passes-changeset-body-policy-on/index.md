---
id: "82a167fd-2f86-49b6-ac28-43f1bcb0c95c"
type: "change"
title: "PR 11 passes changeset-body-policy on its own: shorter static-dispatch changeset lead"
slug: "pr-11-passes-changeset-body-policy-on"
summary: "A release note in this part opens with a sentence longer than the release-notes rule allows, so this part fails a repository check by itself. This brings down the already-reviewed shorter wording."
intent: "Required test tests/e2e/changeset-body-policy.test.js fails at #1082's head: `.changeset/php-static-class-dispatch-property-provenance.md` lead sentence is 35 words (limit 30); PR 12's 612011bd3 shortens it.\n\nEvery PR in the PHP stack must pass main's required checks and CodeQL at its own head, so it can merge to main on its own. Today this PR fails at its own head because the fix only lands in a later PR of the stack. This change ports that fix down, verbatim: the ported lines must end up identical to the later PR's, so the later commit becomes a no-op for them when the stack is restacked, and the stack's top tree does not change.\n\nHow to port: `git show <sha> -- <paths>` shows the later commit's hunks; apply only the hunks for code this PR already has (`git show <sha> -- <paths> | git apply --3way`, then remove what does not belong yet), and adjust only where this PR's context differs. Do not invent new behaviour, rename things or reformat. Run only the tests named in the task.\n\nPrivacy rule: no client name, repository name, path or finding text in this repository. Lane rules: every code change goes through `ndx work`; CI (`ci:run`) runs the suites."
acceptanceCriteria:
  - "This PR (#1082) passes main's required checks and CodeQL at its own head"
  - "The stack's top tree is unchanged by the restack apart from PRD files"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
discoveredFrom: {"item":"e2fb42b1-e547-4682-a2ef-176d0e7d7857"}
tags:
  - "php-stack-green"
  - "php-pr11"
---
