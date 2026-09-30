---
"@n-dx/web": patch
---

Retry a layout-save rename that Windows refuses

The preview server writes the layout through a uniquely-named temp file and
serialises renames per target, which removes the collisions it causes itself.
It cannot remove the ones it does not own: a browser or editor holding the
layout file, a backup agent, an indexer or a virus scanner all make Windows
refuse the rename outright rather than wait, and the save answered 400. A
full-suite run caught exactly that — one 400 among twenty concurrent saves that
were all valid.

The rename now retries ten times at 50ms while the error is EPERM, EACCES or
EBUSY. A non-transient error is not retried, and one that outlasts every
attempt still surfaces as a 400.
