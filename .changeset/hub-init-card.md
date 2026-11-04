---
"@n-dx/web": patch
---

The hub home page tells an uninitialized project from a set-up one: its card offers a single Initialize action instead of Start working and Open dashboard. Initialize runs the setup wizard's own `ndx init` route from the card, under an overlay showing the current step; on success the card turns into the normal one without a reload, and on failure it shows the error with a Retry.
