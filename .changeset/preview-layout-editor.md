---
"@n-dx/core": patch
"@n-dx/web": patch
---

Make the `ndx start --preview` document an editor. The mock-up now renders from `index.layout.json` beside it and writes changes back over `POST /__preview/layout`: drag sections, tabs and panels to reorder them, drop one onto the middle of a group to nest it inside (so sections can be grouped into named dropdowns), rename anything — a rename renders as "New name (previously Old name)" — and add, cut or restore items. Moves, additions and removals are marked in place and collected into a change list for reviewers. The layout file is the artifact: hand-edit it instead of dragging if you prefer, and review it as a diff.
