---
id: "5836feea-95bc-45fd-b94b-1f8a6b44517e"
level: "task"
title: "Replace the id-qualified slug with a title-only slug, guarding merge safety in validate"
status: "pending"
priority: "medium"
blockedBy:
  - "f0ca950b-8ccf-4983-be54-ffa4f99ca4ff"
  - "c1589e68-40c4-46c7-8489-f0a99fbadfb3"
source: "ndx-capture"
acceptanceCriteria:
  - "`slugify` returns a title-only slug with no id-derived component"
  - "`rex validate` fails on a tree where two items share an id, or where a path and its front-matter id disagree"
  - "A test simulates the divergent-branch merge case and shows validate catching it"
  - "The slug length cap is either justified for readability or raised, with the decision recorded"
description: "Change `slugify(title, id)` to drop `appendShortIdSuffix` and stop encoding the id into the path. The suffix is currently unconditional for a documented reason (folder-tree-serializer.ts:240): two same-titled items created on divergent branches land on identical paths and a git merge silently unifies two distinct items. A collision-only fallback does not address it, because each branch sees no local collision. Replace the path-level guard with a check in `rex validate`: fail when a file's front-matter id does not match the item the tree expects at that path, or when two items claim the same id. That catches a bad merge at review time instead of encoding a hex string into every path permanently. Also reconsider MAX_SLUG_LENGTH=40, which exists partly to make room for the suffix and currently truncates title bodies at a word boundary."
lastModified: "2026-09-01T14:11:15.506Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
