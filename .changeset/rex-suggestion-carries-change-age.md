---
"@n-dx/rex": patch
"@n-dx/web": patch
---

Rex's placement suggestion carries the change's `createdAt` and `ageDays`, and the dashboard's placement route reads them instead of copying rex's age rule, so the Inbox age and `rex change inbox` cannot drift.
