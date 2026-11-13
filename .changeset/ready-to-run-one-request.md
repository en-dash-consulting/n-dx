---
"@n-dx/web": patch
---

`Ready to run` loads its complete queue in one request, including on live refresh.

`GET /api/hench/ready?all=1` replaces requests for successive 50-row pages, so selection and the hench runs scan each run once per load.
