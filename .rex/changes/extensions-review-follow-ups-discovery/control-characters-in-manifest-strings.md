---
id: "1466e27e-19f4-413a-bb45-265042446ece"
type: "task"
title: "Control characters in manifest strings can spoof the consent prompt"
slug: "control-characters-in-manifest-strings"
description: "Verdict: must-fix (consent is the trust boundary; fix is cheap). checkPackagePath and checkString (packages/core/extension-manifest.js) accept control characters in bin, displayName, hub.label and link labels; version and packageName (extension-discovery.js:355-356) are unvalidated; describeForApproval (extension-state.js:200-209), list and info print them raw. Trigger: version or bin containing ESC sequences or a newline rewrites the 'source project (path)' line the user approves. Fix (recommended, both): a manifest rule rejecting \\p{Cc} in every string, validating version as semver in discovery; and escape non-slug fields on display."
acceptanceCriteria:
  - "A manifest string containing a control character is invalid under a named rule with a failing and passing fixture"
  - "A package whose version is not semver is reported, not listed as approvable"
  - "The approval prompt, list and info never print a raw control character from a package"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
