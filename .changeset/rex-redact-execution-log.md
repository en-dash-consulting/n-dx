---
"@n-dx/rex": patch
---

Redact credential-shaped text in `appendLog` details before truncation, and strip C0 control characters (other than newline and tab) from the event and detail fields of execution-log entries.
