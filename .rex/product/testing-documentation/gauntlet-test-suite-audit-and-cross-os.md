---
id: "ed5d632a-0385-4cbf-87b4-7f1d929eaf30"
type: "capability"
title: "Gauntlet Test Suite Audit and Cross-OS Validity Review"
slug: "gauntlet-test-suite-audit-and-cross-os"
statement: "The gauntlet suite holds only release-relevant cross-OS checks, and the CI pipeline's cross-OS validation stage still catches the regressions the gauntlet was built to catch."
criteria: [{"id":"c1","text":"The CI pipeline shall run a cross-OS validation that catches the class of regressions the gauntlet suite was designed to catch."},{"id":"c2","text":"When a niche gauntlet case is removed because an existing unit or integration test covers its behaviour, that unit or integration suite shall keep exercising the behaviour the gauntlet case covered."},{"id":"c3","text":"When a niche gauntlet concern is still worth keeping, the gauntlet suite shall assert it across more inputs or platforms than the original single case did."}]
source: "smart-add"
---

Perform a comprehensive audit of the gauntlet directory to determine whether each test still exercises a meaningful, release-blocking invariant, whether the cross-OS pipeline stage remains necessary, and whether any tests have become too narrow or implementation-coupled to justify their maintenance cost.
