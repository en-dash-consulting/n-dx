---
id: "41df209d-75fa-412c-8f5a-784d08cf2a31"
type: "change"
title: "Add the missing changeset for Terraform files entering the inventory"
slug: "add-the-missing-changeset-for-41df20"
intent: "Stack review (#767): no changeset. After this PR every repo containing .tf files gains inventory.json entries for them (.tf leaves summary.skippedExtensions) and manifest.languages gains terraform. Add a @n-dx/sourcevision patch changeset describing both. Changeset file only."
acceptanceCriteria:
  - "A @n-dx/sourcevision patch changeset describes .tf files in inventory.json and terraform in manifest.languages"
amends: [{"target":"8b4b34af-ec1d-4593-8266-67e39928289c","delta":"modified","summary":"Add the missing changeset for Terraform files entering the inventory","base":"ee8908d5bb62d2b4344322eacaf3cca376143edb322cd6571f7aeda54da52b97"}]
priority: "high"
source: "review"
---
