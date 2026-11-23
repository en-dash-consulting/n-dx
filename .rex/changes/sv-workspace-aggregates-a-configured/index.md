---
id: "2e3dfb4f-23ef-46d1-95d4-e51650366929"
type: "change"
title: "sv workspace aggregates a configured member that resolves outside the project"
slug: "sv-workspace-aggregates-a-configured"
summary: "A repository's own settings file can name a folder outside the project as a workspace member, and the workspace command then copies that folder's analysis into this project's results. Members should stay inside the project."
intent: "Out-of-scope finding from the adversarial review of f9173794 (sub-analysis discovery never follows symlinks). It is pre-existing: that change fixed auto-detection only.\n\n**Scenario.** A tracked `.n-dx.json` (or `.ndx/config.json`) holds `sourcevision.workspace.members: [{\"path\": \"../other-project\"}]`, or a member path inside the repo that is a symlink to another project. `sv workspace` reaches `resolveMembers` and then `resolveWorkspaceMembers` (`packages/sourcevision/src/analyzers/workspace-aggregate.ts:133-141`). That code resolves `resolve(absRoot, member.path)` with no containment or realpath check, reads the outside project's `.sourcevision/`, and writes its zones, inventory paths and imports into this project's aggregated `zones.json`, `inventory.json` and `imports.json`. The repository content therefore widens what n-dx reads, against the untrusted-repository-content constraint. The change-level acceptance criterion \"No analysis reads, writes or reports anything outside the project root through a symlink\" also does not hold for configured members.\n\n**Reachable:** yes, through `sv workspace` / `ndx` workspace aggregation whenever the project config lists members. Auto-detection (`detectSubAnalyses`) is already contained.\n\n**Options.**\n1. (Recommended) In `resolveWorkspaceMembers`, refuse a member whose realpath, or whose analysis directory's realpath, is outside the root's realpath. Throw the same kind of error as a missing analysis, naming the member. Reuse the `isWithin` and `realpathOrResolve` helpers from `analyzers/workspace.ts`, exported or moved to `util/`. Cost: small. Risk: a user who deliberately aggregates a sibling checkout loses that ability.\n2. Allow outside members only from the user's untracked `.n-dx.local.json`, or after `ndx trust accept`. Cost: larger. It keeps the sibling-checkout use case.\n\nDecision for the owner: whether aggregating sibling checkouts outside the root is a supported use. If not, take option 1.\n\nVerdict: out-of-scope, severity medium."
acceptanceCriteria:
  - "A workspace member whose path resolves outside the project root (../x or a symlink inside the root pointing out) is refused by sv workspace with an error naming the member, and nothing from it reaches the aggregated output"
  - "A member whose analysis directory (.sourcevision or a .ndx container) resolves outside the root is refused the same way"
  - "Members inside the root aggregate exactly as before (existing workspace-aggregate tests pass unchanged)"
  - "A test creates an outside project with an analysis, lists it as a member by relative path and by symlink, and asserts both are refused"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "medium"
discoveredFrom: {"item":"f9173794-5641-4098-b703-826467da5886","run":"03c82860-b625-4032-a71a-f35ce676f2cc"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "sourcevision"
  - "privacy"
  - "estate-readiness"
source: "ndx-adversarial-review"
---
