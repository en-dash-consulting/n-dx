---
id: "d9f42248-f13b-4df5-929f-a2ba5c821a08"
type: "change"
title: "PHP tenant config sources stop silently at the 50-candidate include cap"
slug: "php-tenant-config-sources-stop"
summary: "On a multi-tenant PHP site with more than fifty per-tenant config files, only the first fifty are reported as config sources and the report does not say any were left out, so the tenant count looks smaller than it is."
intent: "Found by an adversarial review of efa70788 (php-config). Verdict: should-fix, low.\n\nScenario: a host-selected include `include 'config/' . $_SERVER['HTTP_HOST'] . '.php';` over a `config/` holding 80 tenant files. `WrittenImport.candidates` is cut at MAX_INCLUDE_CANDIDATES (50, packages/lang-php/src/php-includes.ts), so packages/lang-php/src/php-config.ts (readConfigFacts, the `tenants` loop over `w.candidates`) marks only 50 files as tenant config sources and emits 50 `*` reads. Its `[php-host-include] N files ... are tenant config sources` notice reports 50 and never says the list was cut. The resolver's own notice does say \"(cut at 50 files)\", but config.json and this notice do not.\n\nReachable: `sv analyze` with the PHP pack on any repository whose host-selected include matches more than 50 files. That is plausible for the 38-repo consolidation engagement, where sizing tenants is the goal.\n\nOptions:\n1. (Recommended) Mark the cut in the tenant notice (\"N of at least M files\" or \"(cut at 50)\"). This needs the outcome's `total`, which the framework context does not carry today. Expose it on the written import, or read it through a prepared-resolver `includes()` accessor on FrameworkContext. Cost: small, plus a contract decision.\n2. Lift the cap for host-selected includes only. More complete, but it risks very large candidate lists."
acceptanceCriteria:
  - "A host-selected include matching more than 50 files gives a [php-host-include] tenant-source notice that says the list was cut, with the total"
  - "An integration test with 51+ tenant files fails today and passes once fixed"
touches:
  - "76778b68-080b-4c18-83e7-f4c4e0407291"
priority: "low"
discoveredFrom: {"item":"efa70788-9d7a-49e7-9250-1890d7455315","run":"64e5d13f-7b6c-4b21-aa54-2d1ad86998e6"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "lang-php"
source: "ndx-adversarial-review"
---
