---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Offer to migrate a non-conformant PRD tree at the gate, and stop rather than continue

A tree whose slug-rule marker names another rule, or whose paths do not match the
running rule, used to dead-end a run with a refusal and an instruction to go and
run `rex migrate-slugs` by hand. `ndx work` and the dashboard's Execute now close
that loop — and stop there.

Stopping is the point. On a non-conformant tree `migrate-slugs` is not a no-op: it
rewrites every path that does not match the running rule, which can be the whole
tree. The command exists to perform that rename deliberately, in one reviewable
commit, instead of letting the next ordinary save produce a surprise mass diff.
Running it inside a task run and carrying on would turn it straight back into that
surprise diff, with the rename landing in whatever commit the task makes next under
a message about something else — the 2026-09-17 incident (a pull request merging
1,570 re-slugged files through green CI) with the human step deleted rather than
automated. So the migration gets its own commit, and the operator reviews it and
starts the run again.

- **CLI.** An interactive `ndx work` prints the paths the migration would rename
  and asks. Accepting spawns `rex migrate-slugs`, reports what changed, and exits
  without executing the task. Declining rethrows the refusal unchanged.
- **Autonomous runs are never offered it.** `--auto`, `--loop`, `--epic-by-epic`,
  `--yes`, a non-terminal stdin and CI all refuse exactly as before, and the
  message now names which of those withheld the offer instead of the run silently
  behaving differently from an interactive one. `--dry-run` is never offered it
  either, even on a terminal: a dry run promises not to touch the working tree.
- **Dashboard.** The 412 from Execute now carries `migratable`, and Start Task
  offers a "Migrate the PRD tree" button under a refusal a migration would fix.
  Accepting sends a second explicit `{ migrateSlugs: true }` request — consent is
  carried by the request rather than inferred, since the server has no session —
  which migrates and returns without starting the task.
- **A tree on a newer rule gets no offer at all**, in either surface.
  `TreeConformanceRefusal` gained a `migratable` flag computed from the same
  direction rule `assertSlugRuleAdoptable` enforces, so a gate cannot offer a
  migration the command would refuse.

The store-level write guard is unchanged and still refuses from inside the PRD
lock, which is where it has to stay: `migrate-slugs` needs that same lock, so
recovering there would deadlock.
