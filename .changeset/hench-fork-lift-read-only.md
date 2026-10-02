---
"@n-dx/hench": patch
---

Forked task sessions are told orientation is over. The first user turn of every forked spawn now starts with a fixed sentence lifting the orientation session's read-only instruction (`ORIENTATION_LIFT_NOTICE`), so a fork no longer refuses to edit (#473). The orientation prompts now limit "do not modify anything" to the orientation session.
