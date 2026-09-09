---
"@n-dx/web": patch
---

Explain a finding in plain language from Problems and Suggestions.

A findings row says *that* something is wrong — type, severity, zone, message.
It does not say what that means for this codebase or what fixing it would
touch. Each row now offers Explain, which opens the Ask panel on that finding
and answers without a second click.

The finding travels as named fields (`type`, `severity`, `zone`, `message`,
`files`) on a new optional `finding` on `POST /api/sourcevision/ask`, not as a
pre-written sentence. Sending prose would mean the model reads someone's summary
of the finding instead of the finding, and whatever the summary left out would
be gone; fields also make the request assertable, so a test can check the zone
and files arrived intact. The server renders them as labelled lines after the
`CONTEXT.md` digest, so the zone named in the finding is one the surrounding
analysis has already described. A finding the analysis never classified keeps no
severity rather than being defaulted to `info`.

Explain appears only where it leads somewhere: both surfaces gate it on the
`sourcevision.ask` toggle, and `FindingsList` renders no button unless the
caller supplies a handler. Legacy free-text insight rows are left without one —
they have no type, zone, or files to explain.

The seed crosses views through a one-slot module channel rather than route
state, which carries scalars and feeds the URL and crash snapshot. Taking it
clears it, so an explanation cannot silently attach itself to the next question
typed by hand. The panel shows the attached finding and offers Detach.
