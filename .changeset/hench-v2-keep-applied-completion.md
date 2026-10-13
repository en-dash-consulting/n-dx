---
"@n-dx/hench": patch
---

On a v2 tree, a failure after a completion applied its change no longer
reopens the change.

Completing a change's last task applies its amendments to the product layer.
A later failure (a rejected commit, review-repair staging or commit, or a
bypassed completion followed by a failed test gate) used to reset the task
and the change to pending, while the change kept `appliedAt` and the product
layer kept the amendment. hench now keeps that completion and fails the run.
The error lists every uncommitted path and gives the commands to commit them
under the task's `N-DX-Item` trailer. A completion that applied nothing is
still withdrawn as before, and v1 trees are unchanged.
