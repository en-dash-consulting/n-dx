---
"@n-dx/web": patch
---

The Prepare task modal replaces the Adversarial review On/Off switch with a Review field (Off, Self or Pair) and adds a Reviewer vendor field, each showing its resolved default and source. Save writes `reviewMode` and `reviewVendor` into the task's run block, and the copied `ndx work` line carries `--review-mode` and `--reviewer`. Pair is disabled while `GET /api/hench/prep/:taskId` reports `pairSupported` false; the route now reports it.
