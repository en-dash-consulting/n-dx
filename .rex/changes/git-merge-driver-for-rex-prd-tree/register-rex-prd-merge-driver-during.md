---
id: "2e82c5d4-c551-4200-bfd8-86cd94412a50"
type: "task"
title: "Register rex-prd merge driver during ndx init (.gitattributes + git config, idempotent)"
slug: "register-rex-prd-merge-driver-during"
description: "PR 2: extend packages/core gitattributes-pins.js so ndx init pins '.rex/prd_tree/** merge=rex-prd' in .gitattributes and registers merge.rex-prd.driver in git config, idempotently (re-running init changes nothing). Covered by an init-level test asserting idempotency."
---
