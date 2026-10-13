---
"@n-dx/rex": patch
"@n-dx/web": patch
---

Edit the product map directly, and set the two PRD settings from the dashboard.

**Direct edit, with an editorial checkbox.** The capability page can now edit a
node's spec in place. The checkbox is the point: checked, it says the wording
moved and nothing was asked for, so the node stays met and the edit is recorded
as history; unchecked, the spec has moved ahead of the build and a change is
drafted to build the difference. Only the author can tell those apart, so the
form asks rather than guessing — and names which of the two is about to happen
before the edit is submitted. The checkbox is disabled, with the reason beside
it, on a node rex would refuse it for: one already revised (re-stamping would
mark the unbuilt revision met) or one never met (there is no met spec to
re-stamp). Inherited criteria are not editable here, because they belong to the
capability they come from. The page submits the edit and renders the capability
it is handed back; what an edit does to a node's status stays rex's to decide.

**Workflow settings.** `rex.applyOn` (when a completed change's amendments
reach the product layer) and `rex.placement.autoAccept` (when a placement is
taken without a person) are now on the Workflow page, saved to the same
`.n-dx.json` the CLI reads. What counts as valid is rex's to say, not the
dashboard's: `APPLY_ON`, `PLACEMENT_AUTO_ACCEPT`, both defaults and both
parsers now come through the web→rex gateway, so the chooser offers exactly the
values the parser accepts and `PUT /api/rex/settings` refuses anything else. A
chooser with its own list would write a setting the CLI silently falls back
from, which reads as a save that did nothing. For the same reason the page
surfaces rex's own warnings about values already in the file that it had to
fall back from.

**Bitbucket remotes.** The dashboard's repository name is read through the
shared remote-URL parser rather than a local regex, so Bitbucket Cloud and Data
Center remotes — including the `/scm/` clone prefix and the ssh-on-7999 form —
resolve as the analysis manifest and the iso export already resolve them. The
local copy answered correctly for the common forms; what it could not do was
guarantee it answered the *same* thing, which is the whole reason the parser is
shared. Covered by tests over every form the route can be given, and over a
real Data Center remote read from a git checkout.
