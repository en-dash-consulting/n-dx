---
"@n-dx/llm-client": patch
---

Credential store writes work on an ndx home whose volume has no hard links (exFAT, FAT, macOS smbfs). Where linking fails with ENOTSUP, EOPNOTSUPP, ENOSYS, EPERM or EXDEV, the lock and the takeover guard are published as a directory and their filled holder file is renamed in. A lock directory with no holder file yet is always treated as held, never as stale.
