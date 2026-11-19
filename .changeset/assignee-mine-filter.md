---
"@n-dx/web": patch
---

The Inbox and the Changes page open on your own items when you have open work assigned, with an "Assigned to" filter for Mine, All or one person.

"You" is the identity `ndx work --mine` uses (git `user.name` and `user.email`), matched by email. With nothing open assigned to you, the filter starts on All. The filter only hides rows: switching to All shows every item again, lists keep their order, and Apply all still counts every waiting change.
