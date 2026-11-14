---
"@n-dx/hench": patch
---

With `hench.testGate.hostSlot` on, a network change that renames the host (macOS `ryans-mbp.local` → `ryans-mbp.lan`) no longer lets two test runs on one machine run at once.

The slot directory is now named after a hash of the machine id (Linux `/etc/machine-id`, macOS `IOPlatformUUID`, Windows `MachineGuid`), falling back to a hash of the hostname when none can be read; no raw id is written to disk. The command hench runs inside the slot also gets the slot's directory as `NDX_VALIDATION_SLOT_DIR` beside its token, so a slot acquire it starts nests in its parent's slot even if its own lookup would differ.
