---
id: "d791f030-8142-4d2b-922e-c6e5e835bade"
type: "change"
title: "A brief Windows sharing violation on release leaves the validation slot held by a live hench process"
slug: "a-brief-windows-sharing-violation-on"
summary: "On Windows, if another program briefly has the slot's record file open when hench gives the slot back, the slot can stay taken until that hench process validates again or exits, so other worktrees wait for no reason. Retrying the removal briefly, as the record-update step already does, would avoid that."
intent: "Out-of-scope finding from the adversarial review of task de29498f (Make the host slot tests hold on Windows); the code predates that task (commit 690dabc4e).\n\nScenario: on Windows, an antivirus scanner or indexer has holder.json open without delete sharing at the moment release() unlinks it. unlink fails with EPERM or EBUSY. release() records the token as orphaned (rule 5a) and the gate warns. The record stays on disk naming a live pid, so hench processes in other worktrees wait until this process runs its next validation or exits. In an `ndx work` loop that can be the whole length of an agent task.\n\nEvidence: packages/hench/src/process/validation-slot.ts, heldLease().release calls unlinkIfExists once. replaceAtomically() in the same file already retries EPERM/EBUSY/EACCES (RENAME_ATTEMPTS, backoff of 20 ms × attempt).\n\nReachability: Windows only, and only on a transient sharing violation. Not reproduced; inferred from Windows file-sharing semantics. Severity low, verdict out-of-scope (pre-existing).\n\nOptions: (1) Recommended: retry the release unlink on EPERM/EBUSY/EACCES with the same bounded backoff as replaceAtomically. A small change with a unit test that injects a failing unlink; risk is a release delayed by up to ~0.1 s. (2) Leave as is: rule 5a eventually recovers, but other worktrees wait in the meantime."
acceptanceCriteria:
  - "When the release unlink of holder.json fails once with EPERM, EBUSY or EACCES and then succeeds, release() resolves without throwing and holder.json is gone"
  - "A unit test injects a transient unlink failure on release and fails against the current single-attempt unlink"
  - "A persistent unlink failure still throws from release() after the bounded retries, and the token is still recorded as orphaned (rule 5a)"
touches:
  - "f7e6bab2-0bc4-45fc-8743-edcee40b2f2b"
priority: "low"
discoveredFrom: {"item":"de29498f-6556-4355-b68b-d5c4b3c11129","run":"0ba5fde0-e078-4474-a995-a6cb2d0cfb51"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "windows"
  - "validation-gate"
source: "ndx-adversarial-review"
---
