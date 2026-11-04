---
id: "f0fc0bff-bffc-4c87-bf87-0854ce249383"
type: "capability"
title: "Hub home sets up an uninitialized project in place"
slug: "hub-home-sets-up-an-uninitialized"
statement: "The hub home page tells an uninitialized project from an initialized one, and lets the user initialize it from its card with visible progress before offering the normal project actions."
criteria: [{"id":"c1","text":"The hub overview shall report, for each registered project, whether n-dx is initialized in it."},{"id":"c2","text":"While a project is uninitialized, its hub card shall offer Initialize as its only primary action."},{"id":"c3","text":"While initialization runs from the hub, the project's card shall show progress and block its actions."},{"id":"c4","text":"When initialization from the hub succeeds, the card shall show the actions of an initialized project without a page reload."},{"id":"c5","text":"If initialization from the hub fails, the card shall show the error and offer a retry."}]
---

## History

- 2026-11-04 94e7c673-8696-411f-a60e-07080fd2a14a added: Hub home: offer Initialize for an uninitialized project, with in-card progress
