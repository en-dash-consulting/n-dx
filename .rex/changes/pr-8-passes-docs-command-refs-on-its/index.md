---
id: "9716d93e-d1bf-4f14-935a-f3caaaeb597d"
type: "change"
title: "PR 8 passes docs-command-refs on its own: PHP functions written as calls"
slug: "pr-8-passes-docs-command-refs-on-its"
summary: "A documentation check mistakes PHP function names in the docs for assistant tool names, so this part fails by itself. This brings down the already-reviewed fix that tells the two apart."
intent: "Required test tests/e2e/docs-command-refs.test.js fails at #1075's head (CI run on #1075; locally at restack/pr08): it reports `docs/packages/sourcevision.md: get_headers` and `set_magic_quotes_runtime` as MCP tool names. PR 11 (#1082) fixes it in c9ad315f1: `mcpToolRefs` ignores a name written as a call, and the PHP pack docs write functions as calls.\n\nEvery PR in the PHP stack must pass main's required checks and CodeQL at its own head, so it can merge to main on its own. Today this PR fails at its own head because the fix only lands in a later PR of the stack. This change ports that fix down, verbatim: the ported lines must end up identical to the later PR's, so the later commit becomes a no-op for them when the stack is restacked, and the stack's top tree does not change.\n\nHow to port: `git show <sha> -- <paths>` shows the later commit's hunks; apply only the hunks for code this PR already has (`git show <sha> -- <paths> | git apply --3way`, then remove what does not belong yet), and adjust only where this PR's context differs. Do not invent new behaviour, rename things or reformat. Run only the tests named in the task.\n\nPrivacy rule: no client name, repository name, path or finding text in this repository. Lane rules: every code change goes through `ndx work`; CI (`ci:run`) runs the suites."
acceptanceCriteria:
  - "This PR (#1075) passes main's required checks and CodeQL at its own head"
  - "The stack's top tree is unchanged by the restack apart from PRD files"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
discoveredFrom: {"item":"a6e82740-8767-4eba-86f9-e53327fdfc9a"}
tags:
  - "php-stack-green"
  - "php-pr08"
---
