---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

The OS sandbox lets confined test gates and agent shells use the host validation slot in `<ndx home>/validation-slot/`, so the slot works with `NDX_SANDBOX` on.

Before this, a confined command that took the slot (the repository's own test runner, or a gate with `hench.testGate.hostSlot` on) failed with `EPERM` before any test ran, because the sandbox denies the ndx home. Tool children and the vendor CLI now get read and write access to that one directory, which holds only pids, tokens, timestamps and project paths. The dashboard token, the credential store and the rest of the ndx home stay denied, and git hooks get no access. The directory is created before the spawn. A nested acquire now reads the holder record before it creates or writes anything, so it needs read access only.
