# Bugs and hotfixes

::: warning Ships with 1.0.0
This page describes the 1.0.0 model, which is still landing.
:::

A bug is the build drifting from an unchanged spec. So a **fix** is a change that *touches* a capability without amending it. Engineers own fixes; stewards are pulled in only when a fix needs the spec to say something new.

## Intake and placement

Every source creates a change in the Inbox: a GitHub issue, a user report, a hench run's follow-up, an adversarial review finding, a failing check, a SourceVision finding.

Bugs usually arrive with evidence: a stack trace, a file path, a failing test. Looking those files up against each capability's *realized by* edge finds the capability without a model call. Until commit history fills in, the placement shortlist does the job.

## Triage outcomes

| Outcome | What happens |
|---------|--------------|
| Accepted | The change touches the capability, which reads *defective* while the fix is open |
| Duplicate | Merged into the open change; the issue is added to its issues list |
| Actually a feature request | An amendment is added, and the kind becomes Enhancement on its own |
| Works as intended | Cancelled, usually with a clarifying criterion added to the spec, because the spec was ambiguous |
| Won't fix | Cancelled with a reason |

## Spec gaps

If the bug showed the spec was silent (for example, "WHEN the path has a trailing slash…"), the fix also amends the capability, and that part goes to the steward. The fix itself does not wait on it.

Regression tests live in code, inside the suites a capability's requirements point at. Adding a test case does not touch the product layer.

Code-health findings ("Fix … in … zone") touch the architecture-integrity constraint, not a product capability. They read as refactors and stay out of the steward's view.

## Hotfixes

A hotfix is not a type. It is a fix with a patch `plannedRelease` and critical priority. It may start before it is placed, because `needsPlacement` only stops autonomous selection: `ndx work --task=<id>` can run it. Placement is required before it closes. Release tags exist for every version, so a hotfix branch starts from the tag.

### Example: #473

Before the 1.0.0 model, #473 (forked task sessions refuse to edit) was a top-level epic named "Hotfix · #473 …", holding one feature. In the new model it is one change touching Session strategy, with `plannedRelease: 1.0.1` and critical priority. While it is open, Session strategy reads *defective*. When it merges, the capability returns to *ok*; when 1.0.1 publishes, the release pipeline stamps `shippedIn` on the change. Nothing is left behind.

Back to [the PRD](./) · [Changes and apply](./changes-and-apply) · [Skills Reference](../skills)
