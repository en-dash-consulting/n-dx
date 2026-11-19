---
"@n-dx/web": patch
---

Inbox rows, backlog rows on the Changes page and the change detail panel now have an assignee picker that suggests the repository's people and accepts any id or email.

The suggestions are you, the git commit authors and the product layer's stewards, one entry per email, read from the new `GET /api/rex/people`. Picking someone saves their `Name <email>`; for you that is exactly the identity `ndx work --mine` matches (git `user.name` and `user.email`), whatever spelling your commits use, and you are listed even before your first commit. Typing a known person's email saves that same form, and anything else is saved as typed for someone not in the repository yet. An item assigned to your email under another spelling is marked "not matched by ndx work --mine", since the CLI compares the whole string. Unassign clears the field. The picker writes the item's existing `assignee` field through `PATCH /api/rex/items/:id`, which now accepts it (trimmed; empty removes it).
