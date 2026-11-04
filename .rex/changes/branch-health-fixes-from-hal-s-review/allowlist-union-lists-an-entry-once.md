---
id: "cf457468-5ec5-4a59-8de8-3edab986760d"
type: "task"
title: "allowlist-union lists an entry once when both sides added it"
slug: "allowlist-union-lists-an-entry-once"
description: "Review finding F4 (https://github.com/en-dash-consulting/n-dx/pull/930#discussion_r4469226266). unionResult in packages/web/src/server/branch-health/conflicts.ts joins the branch's and the base's hunk lines unchanged; with merge.conflictStyle=diff3 git does not factor out lines common to both sides, so ancestor [a,b,z] with base adding shared,theirs and branch adding shared,mine is offered as shared,mine,shared,theirs. Drop each base line whose trimmed, comma-stripped text already appears among the branch's lines in that hunk."
acceptanceCriteria:
  - "When both sides of a hunk add the same entry (ignoring whitespace and a trailing comma), the offered union lists it once (tested with Hal's fixture through git merge-tree)"
  - "Distinct entries keep ours-then-theirs order, and every existing allowlist-union test passes"
priority: "low"
---
