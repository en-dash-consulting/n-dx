---
"@n-dx/rex": patch
"@n-dx/web": patch
---

On a v2 project the dashboard's add panel no longer calls itself Smart Add or says it generates proposals. It is "Add to Inbox": the text becomes one change in the Inbox, its first line the title and the full text its description, and the preview shows both and names the next step (place the change, then add its tasks). `rex add --format=json` on v2 now includes each change's `description`. v1 projects keep Smart Add as it was.
