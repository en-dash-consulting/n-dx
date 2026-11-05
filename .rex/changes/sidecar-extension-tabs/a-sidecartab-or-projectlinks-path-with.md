---
id: "bb7ecdb1-ded5-41ed-9469-ee8fe7253d7a"
type: "task"
title: "A sidecarTab or projectLinks path with a dot segment resolves outside /x/<name>/"
slug: "a-sidecartab-or-projectlinks-path-with"
description: "Found by ndx-adversarial-review of task 66cd459f (verdict should-fix, severity medium).\n\nScenario: an approved extension declares sidecarTab.path \"/../../api/hub/extensions\" (or \"/%2e%2e/%2e%2e/\"). The validator (packages/core/extension-manifest.js checkLinkTarget) accepts it: it only checks the leading / and the placeholders. resolveProjectLink (packages/web/src/hub/extensions.ts) returns \"/x/recon/../../api/hub/extensions\", which a browser normalizes to \"/api/hub/extensions\". The tab then leaves the extension's mount, and once the frame key lands it also leaves the keyed /x/<name>/~f/<key>/ paths. The docs and the change's criterion say the path \"resolves under /x/<name>/\". projectLinks have had the same gap since before this change.\n\nReachability: through any installed, approved extension manifest, so the user already trusts the extension's code. The iframe sandbox still gives the page an opaque origin. The defect breaks the stated containment, not the sandbox.\n\nOptions: (A, recommended) the validator refuses a path containing a \".\" or \"..\" segment, raw or percent-encoded, under url-path or a new rule with a fixture. This costs one rule and a test, and it covers projectLinks too. (B) resolveProjectLink normalizes the result and returns null when it leaves /x/<name>/. That is defence in depth at the hub, so either fix can land without the other."
acceptanceCriteria:
  - "validateExtensionManifest refuses sidecarTab.path and projectLinks[].path containing a '..' or '.' segment, raw or percent-encoded (%2e), with a rule that has a failing and a passing fixture"
  - "A test shows every tab and link URL the hub returns, after URL normalization, still starts with /x/<name>/"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
