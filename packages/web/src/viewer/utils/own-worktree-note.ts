/**
 * The line under a planned lane that must run in a worktree of its own, in
 * hench's wording. Live's Ready next and the Sidecar run-plan card both show it.
 * The viewer's gateway is at its export cap, so this mirrors `OWN_WORKTREE_NOTE`
 * in `shared/queue-plan.ts` (which the Guide packet uses); a unit test holds the
 * two equal.
 */
export const OWN_WORKTREE_NOTE =
  "Run this track in its own worktree: its command targets the current checkout, and two runs in one checkout collide.";
