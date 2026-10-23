---
id: "5836feea-95bc-45fd-b94b-1f8a6b44517e"
type: "change"
title: "Replace the id-qualified slug with a title-only slug, guarding merge safety in validate"
slug: "replace-the-id-qualified-slug-with-a"
intent: "Change `slugify(title, id)` to drop `appendShortIdSuffix` and stop encoding the id into the path. The suffix is currently unconditional for a documented reason (folder-tree-serializer.ts:240): two same-titled items created on divergent branches land on identical paths and a git merge silently unifies two distinct items. A collision-only fallback does not address it, because each branch sees no local collision. Replace the path-level guard with a check in `rex validate`: fail when a file's front-matter id does not match the item the tree expects at that path, or when two items claim the same id. That catches a bad merge at review time instead of encoding a hex string into every path permanently. Also reconsider MAX_SLUG_LENGTH=40, which exists partly to make room for the suffix and currently truncates title bodies at a word boundary."
acceptanceCriteria:
  - "`slugify` returns a title-only slug with no id-derived component"
  - "`rex validate` fails on a tree where two items share an id, or where a path and its front-matter id disagree"
  - "A test simulates the divergent-branch merge case and shows validate catching it"
  - "The slug length cap is either justified for readability or raised, with the decision recorded"
amends: [{"target":"c83eecc7-a23e-4a3e-aeee-fc022dea0fc1","delta":"modified","summary":"Replace the id-qualified slug with a title-only slug, guarding merge safety in validate","base":"551bbb1cc26184b689593452fb5ad119e60a57a8bbcdc129773f62d25ff17aba"}]
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "f0ca950b-8ccf-4983-be54-ffa4f99ca4ff"
---
