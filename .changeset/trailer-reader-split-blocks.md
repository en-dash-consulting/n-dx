---
"@n-dx/rex": patch
---

Attribute commits whose `N-DX-Item` sits above the closing `Co-Authored-By`

Git reads trailers only from a commit message's final paragraph, so an
`N-DX-Item` separated from the closing `Co-Authored-By` by a blank line was
invisible to attribution. On this repository that hid 57 commits — about 7% of
all history carrying the trailer — from `ndx migrate --plan` and the product
layer's code evidence. Fixing the writers only helps new commits, so those
would never have been attributable.

The reader now recovers an item from the trailing run of trailer-shaped
paragraphs, stopping at the first prose paragraph, and never from a merge
commit, whose body quotes the messages it brings in. A trailer quoted
mid-message is still ignored. The trailer-commit cache version is bumped, so
the first read after upgrading rescans.
