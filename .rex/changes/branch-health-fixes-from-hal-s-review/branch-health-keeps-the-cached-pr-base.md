---
id: "5af6db8a-4de4-416a-9a0c-3ad31e638a9c"
type: "task"
title: "Branch health keeps the cached PR base when gh fails, and names a merge-tree timeout as one"
slug: "branch-health-keeps-the-cached-pr-base"
description: "Review findings F2 (https://github.com/en-dash-consulting/n-dx/pull/930#discussion_r4469226246) and F5 (https://github.com/en-dash-consulting/n-dx/pull/930#discussion_r4469226280) in packages/web/src/server/branch-health/collect.ts. F2: cachedBase is read only when GitHub reads are off, so an expanded strip whose gh pr view fails (offline, expired token) falls back to the default branch, drops the stack and shows no note; nextLayer has the same gap. Use the cache whenever gh failed, keep baseSource 'pr-cached', but not when gh succeeded and found no PR for the branch, since that PR may have merged or closed. F5: Run drops exec's error, so a timeout (exitCode null) gets 'It needs git 2.38 or newer'."
acceptanceCriteria:
  - "With a warm PR-base cache and gh pr view failing, base and each stack layer come from the cache with baseSource 'pr-cached' (tested with a failing gh stub)"
  - "When gh succeeds and reports no PR for the branch, the cached base is not used (tested)"
  - "Run carries exec's error; a merge-tree run with exitCode null reports that it timed out after its limit (tested)"
  - "The git 2.38 hint appears only for exit 129 or stderr naming --write-tree (tested)"
priority: "medium"
---
