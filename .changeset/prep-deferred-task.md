---
"@n-dx/hench": patch
"@n-dx/web": patch
---

A deferred task can be started from the Prepare task modal again. The prep resolve and brief preview now pass `--reset-deferred` for a deferred task, as execute already did, so the modal no longer reports it as not actionable or disables Execute. `ndx work --task=<id> --dry-run --reset-deferred` now builds the brief as if the reset had happened, treating the tasks it would reset as pending, and still writes nothing.
