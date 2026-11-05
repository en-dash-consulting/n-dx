---
"@n-dx/web": patch
"@n-dx/rex": patch
---

A rex item links to a tracker work item and the link shows. Link and Unlink on a task or change write the ref to a v2 item's `issues` or a v1 item's `links[]`; the link shows on the task, change and Live pages with the tracker's label from its server profile; the Sidecar's `propose_link` raises a link card, never allow-listed, that writes only on Approve. The v1 to v2 migration moves a v1 item's `links[]` into `issues`.
