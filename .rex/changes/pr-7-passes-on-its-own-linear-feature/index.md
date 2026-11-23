---
id: "1b008b11-912e-4eeb-b291-b5c8201daea0"
type: "change"
title: "PR 7 passes on its own: linear feature-flag scan and a current iso-map skill script"
slug: "pr-7-passes-on-its-own-linear-feature"
summary: "This part of the PHP work fails two checks by itself: a slow text pattern the code scanner flags, and a generated script that was not regenerated after a change it depends on. This brings in the already-reviewed fix and regenerates the script."
intent: "CodeQL js/polynomial-redos alert #124 (packages/lang-kit/src/pack-contract.ts:395) is open on #1063's merge ref, fixed in PR 11 (#1082) by 87292366a. Required test tests/e2e/iso-skill-drift.test.js fails at #1063's head on every OS (CI run 44407834266): PR 7 added `config: \"config.json\"` to packages/sourcevision/src/schema/data-files.ts, which the iso-map skill bundle inlines, and the committed `.claude/skills/iso-map/scripts/iso-map.mjs` was not regenerated; it was regenerated only in PR 12.\n\nEvery PR in the PHP stack must pass main's required checks and CodeQL at its own head, so it can merge to main on its own. Today this PR fails at its own head because the fix only lands in a later PR of the stack. This change ports that fix down, verbatim: the ported lines must end up identical to the later PR's, so the later commit becomes a no-op for them when the stack is restacked, and the stack's top tree does not change.\n\nHow to port: `git show <sha> -- <paths>` shows the later commit's hunks; apply only the hunks for code this PR already has (`git show <sha> -- <paths> | git apply --3way`, then remove what does not belong yet), and adjust only where this PR's context differs. Do not invent new behaviour, rename things or reformat. Run only the tests named in the task.\n\nPrivacy rule: no client name, repository name, path or finding text in this repository. Lane rules: every code change goes through `ndx work`; CI (`ci:run`) runs the suites."
acceptanceCriteria:
  - "This PR (#1063) passes main's required checks and CodeQL at its own head"
  - "The stack's top tree is unchanged by the restack apart from PRD files"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
discoveredFrom: {"item":"b74c12c2-673c-488b-9559-9f999d9440b4"}
tags:
  - "php-stack-green"
  - "php-pr07"
---
