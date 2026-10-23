---
id: "607c72c9-5edf-4091-b0a8-77eea1484a40"
type: "capability"
title: "PRD tree snapshot must tolerate a concurrent writer's temp files"
slug: "prd-tree-snapshot-must-tolerate-a"
statement: "Before a command mutates the PRD, rex copies `.rex/prd_tree` to a timestamped backup under `.rex/.backups/`. The copy leaves out atomic-write temp files, survives a concurrent writer, and holds exactly the source tree; a partial copy can never become a restore point."
criteria: [{"id":"c1","text":"When rex snapshots the PRD tree, rex shall leave the atomic-write temp files that a concurrent writer creates out of the backup."},{"id":"c2","text":"If a concurrent writer renames its temp file into place while rex is copying the PRD tree, rex shall complete the snapshot instead of aborting the command."},{"id":"c3","text":"When two processes snapshot the PRD tree with the same timestamp, rex shall claim each backup directory with an atomic non-recursive mkdir, so the two snapshots never share a directory."},{"id":"c4","text":"If rex cannot snapshot the PRD tree before a command, rex shall refuse to continue the command and state that without a snapshot the command cannot be undone."},{"id":"c5","text":"When a snapshot copy succeeds after a retry, rex shall keep in the backup exactly the files present in the source when the successful copy ran, and no file left by an earlier failed attempt."},{"id":"c6","text":"If a snapshot copy exhausts its retries, rex shall remove the partial backup directory or mark it incomplete before it reports the failure, so the directory cannot be picked as the newest restore point."},{"id":"c7","text":"The restore command shall never use a partial or empty snapshot as its target."},{"id":"c8","text":"Before a structural migration pass changes the PRD tree, rex shall write a copy of `.rex/prd_tree` to `.rex/.backups/prd_tree_<ISO-timestamp>/` and record the backup path in the migration log."},{"id":"c9","text":"When a structural migration pass would change nothing, rex shall skip creating a backup."},{"id":"c10","text":"If a structural migration fails, rex shall print the backup path and a restore command that can be copied and pasted."},{"id":"c11","text":"Rex shall keep at most a configured number of backups (10 by default, set in `.n-dx.json`) and prune the oldest beyond that number."},{"id":"c12","text":"Rex shall add the backup directory to `.gitignore`."}]
requirements: [{"id":"607c72c9-5edf-4091-b0a8-77eea1484a40:c5","title":"When a snapshot copy succeeds after a retry, rex shall keep in the backup exactly the files present in the source when the successful copy ran, and no file left by an earlier failed attempt","description":"Linked to: packages/rex/tests/unit/core/backup-snapshot-copy-retry.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["When a snapshot copy succeeds after a retry, rex shall keep in the backup exactly the files present in the source when the successful copy ran, and no file left by an earlier failed attempt."]},{"id":"607c72c9-5edf-4091-b0a8-77eea1484a40:c6","title":"If a snapshot copy exhausts its retries, rex shall remove the partial backup directory or mark it incomplete before it reports the failure, so the directory cannot be picked as the newest restore point","description":"Linked to: packages/rex/tests/unit/core/backup-snapshot-copy-retry.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["If a snapshot copy exhausts its retries, rex shall remove the partial backup directory or mark it incomplete before it reports the failure, so the directory cannot be picked as the newest restore point."]},{"id":"607c72c9-5edf-4091-b0a8-77eea1484a40:c7","title":"The restore command shall never use a partial or empty snapshot as its target","description":"Linked to: packages/rex/tests/unit/core/backup-snapshot-copy-retry.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["The restore command shall never use a partial or empty snapshot as its target."]}]
priority: "high"
---

Found by the full-suite run after the #370 follow-up queue on 2026-09-12. Severity: high — it is the only thing keeping PR #370's suite red, and it aborts a real user command, not just a test.

FAILURE SCENARIO
tests/integration/import-bundle-transaction.test.ts > 'does not lose either writer's items when two imports run concurrently' fails intermittently:

  Could not snapshot the PRD tree before 'import-bundle': Failed to snapshot PRD tree to
  .../.rex/.backups/prd_tree_2026-09-12T10-45-48.291Z:
  ENOENT: no such file or directory, lstat '.../.rex/prd_tree/from-second-bundle.md.69197.4f6761f9-....tmp'
  Refusing to continue — without a snapshot there is no way to undo this command.

snapshotPrdTree in packages/rex/src/core/backup-snapshots.ts (~line 183) does . cp walks the tree and lstats each entry. A concurrent writer's atomic-write temp file () exists when the walk reads the directory and is gone when the walk lstats it, because the writer renamed it into place. cp raises ENOENT and the whole command aborts, refusing to proceed without a rollback point.

This is the second race in this function. The comment block immediately above the cp call documents the first one — two processes claiming the same timestamped backup directory and losing to EEXIST — which was fixed with an atomic non-recursive mkdir. The temp-file race was not covered by that fix.

MEASUREMENT
On origin/main: 0 failures in 15 isolated runs. On fix/autonomous-run-reliability: 2 failures in 11 isolated runs (~18%). The branch does not touch backup-snapshots.ts, atomic-write.ts or the test — its only change to folder-tree-serializer.ts swaps a string literal for the identical TREE_META_FILENAME constant. The branch changes write timing inside the transaction path (stampUpdatedItem, runTransaction), which widens the window rather than creating the race. Treat the defect as pre-existing and the branch as the thing that exposed it.

SOLUTION
Pass a `filter` option to cp that excludes atomic-write temp files, so a transient `.tmp` file is never a candidate for lstat in the first place. That is also correct on its own merits: a temp file is not PRD content and must not appear in a rollback point. Derive the pattern from wherever the atomic writer builds those names rather than hardcoding a regex in a second place; if no shared helper exists, add one next to the writer and import it.

A filter alone does not close every window — any entry could in principle vanish mid-walk — so also decide whether ENOENT on a single entry should abort the whole snapshot. A rollback point missing a file that no longer exists is not obviously worse than refusing the command. If you make it tolerant, log what was skipped.

ACCEPTANCE CRITERIA
- The concurrent-import test passes 20 consecutive isolated runs on this branch.
- A unit test drives snapshotPrdTree against a tree containing a temp file and asserts the temp file is absent from the backup and the snapshot succeeds.
- The existing EEXIST/claimBackupDir behaviour is unchanged and still covered.
- Changeset for @n-dx/rex (patch).

Conventions: cross-package imports through the gateway modules; pnpm test from the repo root before declaring done.
