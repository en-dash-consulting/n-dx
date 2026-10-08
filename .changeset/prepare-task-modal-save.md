---
"@n-dx/web": patch
---

Save run settings on a task from the Prepare task modal.

The modal could only ever change a run; now it can change the task. **Save** writes the settings onto the PRD item through `PUT /api/hench/prep/:taskId`, where `ndx work` reads them from a terminal too, while **Execute** still carries the edits and nothing else. Two buttons on purpose: "run it differently once" and "this is how this task should be run" are different intentions, and conflating them would make every experiment permanent.

- **Sources.** A field the task supplies reads "saved on task" with the project default beside it ("project default: claude-sonnet from llm.claude.model"), rather than naming a config key that is not where the value came from.
- **What Save writes.** The fields that differ from the project default, never a launch-time one (`fresh`, `allowDirty`). A field equal to the project default is omitted rather than frozen, so a later config change still reaches the task. An exact model is written per vendor, and a pin for a vendor this project is not on today is carried through untouched.
- **Reset to defaults** clears the edits first; with nothing but saved settings left it asks ("Clear 2 saved settings for this task?") before clearing the block.
- **Conflicts.** A save that lost a race shows "These settings were saved elsewhere since you opened this." with Reload (take the server's, drop the edits) and Overwrite (resend against the version the refusal named).
- **Off the anchor** the footer says "Saved on branch <name>; lands when the branch merges".
- **Footer** counts the two facts separately: what applies to this run, and what is saved and applies from the terminal too. **Ready to run** marks a task carrying saved settings with a labelled dot.

**Behaviour change.** The adversarial review and full-test-gate controls are no longer locked when the config turns them on. They were disabled because nothing could turn them off for a single run; `--no-review` and `--no-skip-test-gate` now can, so switching one off sends the negation flag and the run honours it.
