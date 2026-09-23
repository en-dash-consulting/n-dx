---
"@n-dx/hench": patch
"@n-dx/web": patch
---

A run whose task another worktree takes over mid-run now says so in the dashboard's Sessions tray.

Since claims began being renewed for the length of a run, a refused renewal meant the task quietly left the run's held set: the run carried on by design, and nothing anywhere recorded that the task was no longer its to finish. The renewal now emits the takeover, the run loop stamps it on the run record as an additive `claimLost` entry and saves immediately, and the Sessions tray renders "claim taken over by <worktree>" beside that run. Run records written without the field load unchanged, and `GET /api/rex/claims` is untouched.
