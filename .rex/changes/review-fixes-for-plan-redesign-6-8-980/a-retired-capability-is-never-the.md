---
id: "c1a3d73b-606b-4a74-af66-5bdb948adee0"
type: "task"
title: "A retired capability is never the selection"
slug: "a-retired-capability-is-never-the"
description: "Stack review finding on #980 at packages/web/src/viewer/views/area.ts:156 (review comment 4488638362).\n\n**Should fix: a retired capability can stay selected with no block on the map**\n\n`buildProductMap` still sends retired capabilities. The SpecMap filters them with `liveCapabilities`, but this `listed` check and the `area.capabilities.find(...)` on line 175 do not. If a capability is retired while selected, or is named in the URL, the detail column and the `/capability/<id>` address stay although no block is drawn. That contradicts the comment above (\"a capability retired since… is no selection\"). Run both checks against `liveCapabilities(area.capabilities)` and add a test that marks the row `status: \"retired\"`. Similarly, `counts.capabilities` in `buildAreaDetail` (routes-rex/product.ts:715) counts retired capabilities, so the header can read \"3 capabilities\" next to \"All of this area's capabilities are retired.\""
acceptanceCriteria:
  - "The listed check and the capability lookup in area.ts use liveCapabilities, so a retired capability is never selected"
  - "buildAreaDetail's counts.capabilities excludes retired capabilities (routes-rex/product.ts)"
  - "A test with a capability of status retired covers both"
---
