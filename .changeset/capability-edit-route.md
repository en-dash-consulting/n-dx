---
"@n-dx/web": patch
"@n-dx/rex": patch
---

The capability page's edit form is now reachable from the dashboard.

#729 built the form, but nothing mounted it and no route ran rex's
`handleProductEdit`. `POST /api/rex/product/edit` now applies an edit to a
capability's statement and its own criteria's text inside rex's v2 transaction,
and the capability page passes `onEdit` so a save posts to it and refetches.
The editorial checkbox keeps its meaning: checked records a History line and
keeps the capability met; unchecked marks it revised and drafts a change in the
Inbox to build the difference. On a v1 tree the route answers 409 and the
capability page stays read-only. `@n-dx/rex` now exports `handleProductEdit` and
`ProductEditError`.
