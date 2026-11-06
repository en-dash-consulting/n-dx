---
"@n-dx/web": patch
---

Ready to run loads its whole list in one `GET /api/hench/ready?all=1` request instead of one per 50 rows, so the selection and the hench runs scan run once per load and per live refresh.
