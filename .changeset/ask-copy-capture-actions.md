---
"@n-dx/web": patch
---

Wire Copy and Capture-to-PRD actions on the SourceVision Ask answer

Copy places the raw answer text on the clipboard, preferring the async API and falling back to `execCommand`. A permission denial is reported distinctly from a generic failure, because it is the one copy failure a user can act on — and the wording is now identical to the PR Markdown view by construction rather than by coincidence.

Capture-to-PRD is confirm-guarded: nothing is written until the user agrees, and the result names the created task and the epic it landed under. A failed capture surfaces the reason and leaves the answer on screen and re-copyable. Both actions' feedback clears itself and does not survive into the next question.

Adds `POST /api/rex/capture-ask`, which files one answer as a task under a find-or-create "SourceVision Ask Captures" epic. The write runs inside `store.withTransaction` because it may create the epic and its child together, and those two writes must not be interleavable with another writer.

Also lifts clipboard handling into `viewer/utils/clipboard.ts`. The viewer carried four separate `execCommand` implementations, only one of which distinguished a permission denial; `pr-markdown.ts` and `overview.ts` now share this one, which returns a discriminated outcome so the permission case cannot compile away into a bare `catch`.
