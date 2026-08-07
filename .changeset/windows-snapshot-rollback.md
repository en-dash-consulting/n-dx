---
"@n-dx/rex": patch
---

Fix the PRD rollback snapshot on Windows, and add `rex restore` to use it.

**The bug.** `snapshotPRDTree` named its backup directory `prd_tree_<raw ISO-8601 timestamp>`. ISO-8601 puts colons in the time component (`2026-08-05T17:27:18.959Z`), and `:` is illegal in Windows filenames — reserved for drive letters and NTFS alternate data streams. So the snapshot `mkdir`/`cp` failed with `EINVAL` on **every** Windows invocation. Because `add` and `reshape` caught the failure, printed a one-line warning, and continued anyway, Windows users had been running destructive tree rewrites with no rollback point at all — and the only signal was a line of text above the normal command output. Snapshot ids are now colon-free (`2026-08-05T17-27-18.959Z`), encoded positionally so lexicographic order still equals chronological order, which `getAvailableBackups` depends on.

**Restore was also broken.** `restoreFromBackup` documented "Remove current tree if it exists" but performed a recursive copy with `force: true` — an overlay, not a replace. Any file a command created after the snapshot survived the "rollback", leaving a tree that was the union of both states rather than the point in time it claimed to be. Restore now stages the snapshot beside the live tree and swaps it in, so a partial failure can never leave the project with no PRD.

**Snapshots are now reachable.** Added `rex restore`: lists available snapshots with timestamps and file counts, restores via `--latest` or `--id=<id>`, and confirms before replacing the tree (`--yes` to skip, `--format=json` for scripts). Previously the snapshots existed on disk with no supported way to use them, and the failure hint suggested `cp -r` — a command that does not exist in cmd.exe or PowerShell.

**Coverage widened.** A new `cli/snapshot-guard.ts` centralizes the pre-command snapshot and now guards `add`, `reshape`, `prune`, `reorganize`, `remove`, `move`, and `fix`. The guard **fails closed**: if a snapshot cannot be created, the command aborts rather than rewriting the tree unprotected. `--no-snapshot` opts out for read-only filesystems and CI. `update` is deliberately excluded — it is on hench's hot path and a full-tree copy per task-status transition would be a significant regression.

Regression tests assert the snapshot directory contains none of Windows' reserved characters, that encoded ids stay chronologically sortable, that restore accepts both an encoded id and a raw ISO timestamp (for snapshots written before this fix), and that restore replaces rather than overlays.
