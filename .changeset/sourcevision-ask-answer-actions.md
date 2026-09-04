---
"@n-dx/web": patch
---

Wire Copy and Capture-to-PRD actions onto a SourceVision Ask answer

Two controls under an answer, plus one shared clipboard module and one new PRD
write route.

**Copy reuses the PR Markdown view's path rather than reimplementing it.** The
copy attempt, the `execCommand` fallback, the permission-denied classification,
and the user-facing wording all move to `viewer/utils/clipboard.ts`, which the
Ask panel and `pr-markdown.ts` now share — two consumers, so it clears the
two-consumer rule without becoming a single-consumer module. `copyTextToClipboard`
returns a discriminated result (`{ok: true}` or a named `reason`), so the
branching lives in one place: the modern API is skipped entirely when absent
rather than called and allowed to throw, and a fallback that succeeds reports
success whatever the first attempt's reason was. The four PR Markdown strings
are reproduced byte-for-byte and pinned by a test, so a permission denial reads
identically on both surfaces.

**Capture is confirm-guarded, and says where the item landed.** The first press
only arms the action; nothing is written until Confirm — the shape the Overview
Next Steps panel uses, and for the same reason. `POST /api/rex/capture-ask`
files the exchange as a **task** under a find-or-create "SourceVision Ask"
epic (`LEVEL_HIERARCHY` accepts a task under an epic, so no filler feature has
to be invented), and the response names the created item, its parent, and
whether the epic is new — "Captured to PRD" alone leaves the user hunting for
what they just filed.

**Deliberately no title dedup, unlike `capture-next-steps`.** There the same
recommendation recurs on every analysis and skipping it is a kindness; here the
user pressed Confirm on this specific answer, so discarding the write because
they once asked something similar would be a capture that reports success and
files nothing. Repeat presses are guarded by the confirm step plus an in-flight
ref instead.

A failed capture surfaces the endpoint's own reason in an `alert` region and
leaves the answer intact and re-copyable. Both kinds of feedback are transient
and both are dropped when a new question is submitted — including when that
question fails — so a "Copied" or "Captured" line can never be read as
belonging to an answer it did not come from. Capture's window is five times
Copy's, because its message names a destination the user needs time to read.
