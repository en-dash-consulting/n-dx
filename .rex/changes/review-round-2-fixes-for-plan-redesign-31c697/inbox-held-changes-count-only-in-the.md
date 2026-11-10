---
id: "f8f7cb2f-87ac-42f1-a551-e6774e6a93f5"
type: "task"
title: "Inbox-held changes count only in the Inbox"
slug: "inbox-held-changes-count-only-in-the"
description: "Stack review round 2 finding on #991 at packages/web/src/server/routes-rex/product.ts:319 (review comment 4494499688).\n\n**Should fix: an Inbox change with a target counts as open on the map, and the area view lists it twice**\n\n`isMovingChange` (and so `openChangesByArea`, the badge, `?area=` and Moving now) doesn't exclude changes held for placement. Inbox changes can carry targets. Every product-edit draft is created with `needsPlacement: true` and an `amends` on the edited capability (rex `core/product-edit.ts:150`), and `change-has-target` says an Inbox change \"may have none yet\". Before this PR, `buildAreaDetail` kept a guessed Inbox change out of Moving now with the `else if (relatesHere(…))`. Now `movingHere` pushes it before the guess check. So after someone edits a capability's spec on the Product page:\n\n- The area view lists the draft under **Moving now** and again under **Waiting in the Inbox**, because its top guess is the capability it amends.\n- The badge, the `?area=` list and the Product total count it as open, but the strip counts it under Inbox, not Proposed. So the description's check \"Product page's Open changes = Proposed + In progress\" stops holding as soon as one draft exists.\n\nFix: leave held changes out of the open rule (`isMovingChange = … && !awaitsPlacement(index, change)`, which needs `index`), so they count only in the Inbox, as the strip already does. Add a server test with a `needsPlacement` change that amends a capability in the area. Expect it in `inbox` and not in `openChanges` or `openChangeIds`."
acceptanceCriteria:
  - "isMovingChange in routes-rex/product.ts excludes a change that awaits placement (needsPlacement), so openChangesByArea, the map badge, ?area= and Moving now never count it"
  - "A product-edit draft created with needsPlacement plus an amends is listed only in Waiting in the Inbox, never also in Moving now"
  - "A server test with a needsPlacement change amending a capability in the area expects it in inbox and not in openChanges or openChangeIds"
  - "The Product total still equals Proposed plus In progress"
---
